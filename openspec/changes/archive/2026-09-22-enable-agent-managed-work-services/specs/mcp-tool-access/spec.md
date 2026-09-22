# Spec Delta

## ADDED Requirements

### Requirement: Expose default Work service control through real MCP tools

**Identifier:** MCP-SERVICE-001

Fresh installation default Work configuration SHALL include required stdio MCP server `work-services`. When selected in the active Work context, its discovered tools SHALL be registered in every new/restored Pi SDK Session and be callable through a real MCP request followed by authenticated Core gRPC. Tools SHALL not expose a caller-selectable Work ID, runtime identity, Docker ID, credential, or host path. Core policy, routing, and readiness names SHALL use the canonical `work-services.<tool>` server namespace. Because supported model APIs restrict tool identifiers to letters, digits, underscores, and hyphens, SDK model registration SHALL deterministically project those names to `work-services__<tool>` and route calls back to the canonical MCP name without changing authorization. The `work-services` profile SHALL use the bundled stdio adapter and MUST NOT accept an alternate executable, args, URL, secret references, or a dependency on a Work service under that identity. Required initialization SHALL finish actual discovery and SDK registration before readiness; the runtime report SHALL identify the registered permitted canonical tools. Tool policy allowed/denied SHALL filter canonical MCP names with denied taking precedence. Explicit removal of this MCP server SHALL remove its tools after successful apply; removing only its instructional Skill SHALL not itself grant or revoke tool authority.

#### Scenario: Discover and invoke deployment tools
- **WHEN** a fresh default Work completes initialization and the model selects `work-services__service_create`
- **THEN** the SDK exposes its validated schema and dispatches it as canonical `work-services.service_create` through MCP to Core gRPC; a direct fake callback is insufficient

#### Scenario: Register provider-compatible tool identifiers
- **WHEN** a provider validates the SDK tool list before accepting a model request
- **THEN** every model-facing MCP tool name matches `^[a-zA-Z0-9_-]+$`, remains unique, and is no longer than 64 characters

#### Scenario: Respect denied deployment tools
- **WHEN** active policy denies work-services.service_create
- **THEN** that tool is absent from SDK callable tools and cannot be invoked through the bridge

#### Scenario: Honor explicit MCP removal
- **WHEN** the owner saves mcpServers [] and applies successfully
- **THEN** new/restored Sessions use that active context without deployment MCP tools

#### Scenario: Required adapter fails
- **WHEN** the selected required adapter cannot start or discover tools
- **THEN** Work initialization fails with an MCP-specific diagnostic rather than claiming deployment capability

### Requirement: Separate tool call completion from durable deployment completion

**Identifier:** MCP-SERVICE-002

Service mutation tools SHALL return durable acceptance within the normal bounded MCP call; they SHALL NOT wait through image pulls or full readiness deadlines. The tool set SHALL provide `deployment_context`, `service_create`, `service_list`, `service_get`, `service_update`, `service_start`, `service_stop`, `service_restart`, `service_remove`, `service_retry`, `operation_get`, and `service_logs`. Mutation keys SHALL be required. A timed-out call MUST NOT be retried with a new key automatically; the same key can recover acceptance. Operation reads SHALL stay scoped to service Operations in the caller Work. The adapter SHALL use stdout exclusively for MCP messages and stderr for safe diagnostics, and SHALL exit with its owning agentd under the existing five-second child cleanup bound.

#### Scenario: A slow registry does not exhaust the MCP call
- **WHEN** Core durably accepts creation and image pulling lasts longer than 30 seconds
- **THEN** the tool already returned the accepted Operation, which can be polled without another create

#### Scenario: Lost acceptance response
- **WHEN** MCP observation is interrupted after Core acceptance
- **THEN** a retry using the same key returns the same Operation and service, with no duplicate deployment

#### Scenario: Stop the adapter
- **WHEN** Work stops with the service MCP subprocess connected
- **THEN** agentd closes MCP and reaps the subprocess within the shutdown bound; Core retains accepted Operations

#### Scenario: Reject a substituted built-in adapter
- **WHEN** a Work configuration uses serverId work-services with a different executable or a requiredServiceId
- **THEN** Core rejects the configuration before activation without launching that substituted process
