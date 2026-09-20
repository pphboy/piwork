# Core Service Startup Specification

## Purpose

Defines how a local piwork installation is initialized and run as a durable Core service that can authenticate users, control Docker-backed Works, recover existing instances, and report operational state.

## Requirements

### Requirement: Bootstrap the first administrator explicitly
The Core executable SHALL provide an explicit first-administrator bootstrap command against a selected data directory. It MUST obtain the password from a hidden terminal prompt or standard input, MUST NOT create a default account or password during `serve`, and MUST reject bootstrap after an administrator already exists without modifying that administrator.

#### Scenario: Bootstrap an empty installation
- **WHEN** an operator supplies an account and password to bootstrap an empty data directory
- **THEN** Core creates the first administrator in that directory without printing the password or password digest

#### Scenario: Refuse repeated bootstrap
- **WHEN** an operator invokes bootstrap after an administrator already exists
- **THEN** Core exits nonzero with a concise diagnostic and leaves the existing identity data unchanged

### Requirement: Configure a usable local runtime profile
The Core executable SHALL provide a local configuration command that records a compatible agent image, model provider and model identifier, optional provider endpoint, and a model credential read from a protected file or standard input. The configuration MUST be stored in the selected data directory with current-user-only access, MUST be queryable without returning secret values, and MUST be usable as the default for Work creation.

#### Scenario: Configure an installation from standard input
- **WHEN** an operator selects an agent image and model and supplies the model credential through standard input
- **THEN** Core stores a usable default runtime profile without placing the credential in command arguments, normal output, logs, or public API responses

#### Scenario: Detect an incomplete runtime profile
- **WHEN** Core starts without a usable agent image or model profile
- **THEN** health remains available, readiness reports the missing runtime configuration, and Work creation returns an actionable configuration error

### Requirement: Start one durable Core application
The `piwork-core serve` command SHALL open and migrate the durable Core store in an explicit data directory, acquire exclusive ownership of that directory, initialize identity, Work lifecycle, Docker runtime, recovery, and conversation routing, and listen for HTTP requests only after required initialization finishes. The default listen host MUST be loopback; plaintext binding to a non-loopback address MUST require an explicit opt-in.

#### Scenario: Start a configured local Core
- **WHEN** an administrator and runtime profile exist and the Docker dependency is available
- **THEN** `serve` starts one HTTP listener, emits its effective loopback URL without secrets, and reports ready after recovery completes

#### Scenario: Reject a second Core owner
- **WHEN** another Core process already owns the same data directory
- **THEN** a second `serve` exits nonzero without opening another listener or modifying the store

#### Scenario: Refuse accidental remote plaintext binding
- **WHEN** an operator requests a non-loopback listen address without the insecure-remote opt-in
- **THEN** Core rejects startup with a diagnostic identifying the required opt-in

### Requirement: Expose distinct health and readiness probes
Core SHALL expose an unauthenticated liveness response at `GET /healthz` while the process can serve requests and an unauthenticated readiness response at `GET /readyz` only after store initialization and startup recovery complete. Readiness MUST become unavailable during shutdown and MUST include a safe reason when runtime configuration or Docker prevents Work operations.

#### Scenario: Report a ready installation
- **WHEN** Core has initialized, Docker is reachable, and startup recovery has completed
- **THEN** health and readiness both succeed and readiness identifies the Work runtime as available

#### Scenario: Report a runtime dependency failure
- **WHEN** Core is alive but Docker cannot be reached
- **THEN** health succeeds, readiness fails with a safe dependency status, and no internal stack trace or credential is returned

### Requirement: Authenticate HTTP clients with durable sessions
Core SHALL expose public login and protected logout and current-identity endpoints. A successful login MUST return an opaque bearer token, expiration, and public identity; Core MUST store only a non-reversible token digest. Missing, invalid, expired, or revoked tokens MUST receive stable authentication errors without revealing whether an account exists.

#### Scenario: Log in and inspect identity
- **WHEN** an enabled user submits valid credentials and uses the returned token on the current-identity endpoint
- **THEN** Core returns that user's public identity and session expiration without returning any password material

#### Scenario: Revoke a login session
- **WHEN** a client logs out with a valid bearer token
- **THEN** Core revokes the session and rejects subsequent protected requests made with that token

### Requirement: Expose durable Work lifecycle control
Core SHALL expose authenticated Work create/list/detail, start, stop, retry, delete, and Operation detail endpoints. Accepted mutations MUST return stable Work and Operation identifiers, execute asynchronously through the configured Docker runtime, enforce Work ownership, and expose preparation, readiness, and failure state without reporting a Work ready before its verified agentd generation accepts Runs.

#### Scenario: Create a default configured Work
- **WHEN** an authenticated user creates a Work using the installation's valid default runtime profile
- **THEN** Core persists the Work and Operation, starts one Docker agentd instance, and eventually reports the Work ready or a concrete failure

#### Scenario: Retry a lost mutation response
- **WHEN** a client repeats the same Work mutation with the same idempotency key and content
- **THEN** Core returns the original Work and Operation identifiers without creating another Work or agentd instance

#### Scenario: Hide another user's Work
- **WHEN** a non-administrator queries or controls a Work owned by another user
- **THEN** Core returns the same not-found response used for a nonexistent Work

### Requirement: Expose authorized Session and Run operations
For a ready Work, Core SHALL expose authenticated Session create/list/detail and Run submit/detail/observe/cancel endpoints. Core MUST authorize the user before contacting agentd, route only to the current verified Work generation, preserve Run identity independently of the observing connection, and distinguish transport interruption from a Run terminal state.

#### Scenario: Submit and observe a Run
- **WHEN** a Work owner creates a Session, submits a prompt with an idempotency key, and observes the accepted Run
- **THEN** Core streams ordered events and exposes the final Run status and assistant result produced by agentd

#### Scenario: Reject conversation on a stopped Work
- **WHEN** a user attempts to create a Session or submit a Run for a stopped or unverified Work
- **THEN** Core returns a stable Work-unavailable error without starting a hidden replacement instance

#### Scenario: Lose an observation connection
- **WHEN** the client connection closes while an accepted Run is executing
- **THEN** Core leaves the Run executing and allows a later authorized request to observe or query the same Run

### Requirement: Recover Core and Work state across restart
Core SHALL persist users, login sessions, Works, Operations, runtime generations, and routing information in its data directory. On restart it SHALL reconcile the desired Work state with Docker, adopt the matching existing agentd instance when safe, restore routing only after identity and readiness verification, and MUST NOT create a second active agentd for the same Work.

#### Scenario: Continue after Core restart
- **WHEN** Core stops cleanly while a ready Work container remains running and then starts with the same data directory
- **THEN** the original login token remains valid, Core adopts the existing Work generation, and the user can continue the existing Session without creating a duplicate container

#### Scenario: Recover an incomplete create operation
- **WHEN** Core restarts after Docker created the agentd container but before the create Operation reached a terminal state
- **THEN** recovery adopts or safely reconciles that resource and completes or fails the original Operation without creating a duplicate Work instance

### Requirement: Shut down Core without destroying running Works
On `SIGINT` or `SIGTERM`, Core SHALL stop accepting new HTTP requests, stop lifecycle scheduling, bound the completion of accepted control requests, close agent connections and the durable store, and exit after releasing the listener and store lock. Normal Core shutdown MUST leave running Work containers and their volumes intact for adoption after restart.

#### Scenario: Stop Core and reopen its store
- **WHEN** a running Core receives `SIGTERM` and completes shutdown
- **THEN** it exits within the configured bound, leaves ready Work containers intact, and a new Core process can open and recover the same data directory

#### Scenario: Bound a stalled shutdown
- **WHEN** an accepted HTTP or agent transport operation does not finish within the shutdown grace period
- **THEN** Core closes the remaining connection and completes process shutdown rather than waiting indefinitely
