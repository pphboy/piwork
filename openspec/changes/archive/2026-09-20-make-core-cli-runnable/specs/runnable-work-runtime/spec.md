# Spec Delta

## Purpose

Defines the deployable Docker agent runtime and verified Core-to-agent conversation path that turn persisted Work metadata into a real Pi SDK Session and Run service.

## ADDED Requirements

### Requirement: Build a compatible agentd image from the workspace
The root workspace SHALL provide a reproducible command that builds a local agentd container image containing the compiled agent server and its production dependencies. The image MUST start as a non-root user, expose no Docker socket or host bind by default, and report a protocol/version identity that Core validates before marking a Work ready.

#### Scenario: Build and inspect the local image
- **WHEN** an operator runs the documented agent image build command in a clean checkout after installing dependencies
- **THEN** Docker produces the documented local image and its default entrypoint starts the compatible agentd server as a non-root user

#### Scenario: Reject an incompatible image
- **WHEN** a Work references an image whose entrypoint or protocol identity is incompatible
- **THEN** its Operation fails with an actionable compatibility error and Core never reports that Work ready

### Requirement: Materialize each Work into an isolated Docker runtime
Creating or starting a Work SHALL resolve its configured agent image and model profile, create or adopt one labeled Work network, persistent data/session storage, generation-specific runtime identity, and one agentd container, then wait for verified readiness. Repeating reconciliation MUST adopt matching resources and MUST NOT create two active agentd instances for one Work.

#### Scenario: Start one Work from an accepted configuration
- **WHEN** Core reconciles a valid Work whose desired state is running
- **THEN** exactly one agentd container starts with the Work's data, session, runtime configuration, model credential reference, resource limits, and private network

#### Scenario: Reconcile an existing instance
- **WHEN** Core repeats reconciliation after losing its process state
- **THEN** it adopts the matching labeled container and storage after verification instead of creating a duplicate

### Requirement: Keep model credentials out of public and persisted conversation data
Core SHALL resolve the selected model profile and mount the model credential into the Work as a read-only secret available only to the agentd process. Agentd SHALL read it without copying the credential into Work metadata, Session history, Run events, error messages, or diagnostics returned through Core.

#### Scenario: Start agentd with a model credential
- **WHEN** a configured Work starts with an available model secret
- **THEN** agentd can initialize the selected model while Core and CLI responses reveal only the non-secret provider and model identifiers

#### Scenario: Model credential is missing or invalid
- **WHEN** agentd cannot read or use the selected model credential
- **THEN** readiness or the affected Run fails with a safe model-configuration error that contains no credential value

### Requirement: Authenticate and verify Core-to-agent transport
Agentd SHALL listen only on its Work runtime network and Core SHALL connect using installation-controlled encrypted credentials tied to the Work identifier and runtime generation. Both sides MUST reject a mismatched Work, stale generation, untrusted peer, or direct unauthenticated request; Core MUST route Session and Run calls only after the current generation passes readiness verification.

#### Scenario: Route to the current generation
- **WHEN** Core has verified agentd for the current Work generation
- **THEN** authorized Session and Run calls reach that agentd without exposing its address or transport credential to the CLI

#### Scenario: Reject a stale daemon
- **WHEN** an older agentd generation remains reachable after a replacement starts
- **THEN** Core does not route new calls to it and its attempts to act as the current Work are rejected

### Requirement: Serve persistent Sessions from agentd
Agentd SHALL create, list, read, and continue Sessions through the agent protocol, bind every Session to its Work, persist the Session index and Pi SDK history on retained storage, and restore that history after agentd replacement. Session creation with the same idempotency key MUST return the same Session.

#### Scenario: Create and restore a Session
- **WHEN** a user creates a Session, completes a Run, and the agentd container is replaced with the same Work storage
- **THEN** the replacement lists the same Session and loads its prior Pi SDK message history

#### Scenario: Reject a cross-Work Session request
- **WHEN** a request presents a Session identifier that belongs to another Work
- **THEN** agentd rejects it without returning that Session's history

### Requirement: Execute Runs through the real Pi SDK
Agentd SHALL durably accept a prompt and submission key, execute the Run with the configured model through the Pi SDK, persist ordered mapped events and a unique terminal state, and save the resulting Session history. A client or Core observation disconnect MUST NOT abort execution; explicit cancellation MUST request SDK abort and persist the resulting state.

#### Scenario: Receive a deterministic acceptance reply through the real stack
- **WHEN** the acceptance fixture submits a prompt to a real agentd container configured with the deterministic model
- **THEN** the real Pi SDK executes it, agentd persists its events and result, and the CLI receives the expected assistant text through Core

#### Scenario: Use a real configured model
- **WHEN** the optional smoke is enabled with valid provider credentials and a user submits a prompt
- **THEN** agentd executes the Run through the configured real Pi SDK model and returns a non-empty assistant result

#### Scenario: Retry a lost submit response
- **WHEN** Core repeats the same Session, submission key, and prompt after losing the first response
- **THEN** agentd returns the original Run and does not invoke the model a second time

### Requirement: Preserve Runs independently of transport lifetime
Agentd SHALL allow only one active Run per Work, keep accepted execution alive when an observer disconnects, retain ordered events within documented bounds, and expose Run status and final result after completion. Startup SHALL mark Runs abandoned by a prior agentd process as interrupted and MUST NOT replay them automatically.

#### Scenario: Disconnect while a Run is executing
- **WHEN** the Core-to-agent or client-to-Core observation stream closes during execution
- **THEN** the Run continues and a later observer can resume from a retained cursor or query its final result

#### Scenario: Restart during an active Run
- **WHEN** agentd restarts while a Run was accepted, running, or cancelling
- **THEN** recovery marks that Run interrupted, preserves recorded events and history, and does not repeat model or tool side effects

### Requirement: Drain and retain Work data on lifecycle operations
Stopping a Work SHALL prevent new Runs, perform bounded drain and cancellation, stop agentd, and retain its data and Session storage. Starting it again SHALL reuse that storage. Deleting a Work SHALL remove the runtime instance while following the documented retained-data policy rather than silently deleting conversation history.

#### Scenario: Stop and start a Work with history
- **WHEN** a Work with a completed Session is stopped and later started
- **THEN** the new agentd process becomes ready with the same Session and completed Run history available

#### Scenario: Stop cannot be confirmed
- **WHEN** Docker cannot confirm that agentd stopped within the lifecycle bounds
- **THEN** the Operation remains failed or incomplete with an explicit dependency error and Core does not report the Work stopped
