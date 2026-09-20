# Spec Delta

## Purpose

Defines an executable local `piwork` command-line client that connects to Core, manages a durable login credential safely, controls Docker-backed Works, and conducts persistent agent conversations.

## ADDED Requirements

### Requirement: Resolve one Core endpoint consistently
The `piwork` CLI SHALL resolve one Core base URL from an explicit `--core` option, the `PIWORK_CORE_URL` environment variable, the URL in a saved credential record, or a documented loopback default in that precedence order. Users MUST NOT need container addresses, Docker credentials, or agent certificates.

#### Scenario: Override the Core URL explicitly
- **WHEN** a user invokes a networked command with `--core <url>` while another URL is stored or set in the environment
- **THEN** the CLI sends the request to the explicit URL

#### Scenario: Reuse the saved endpoint
- **WHEN** no explicit or environment URL is present and a saved credential contains its login endpoint
- **THEN** the CLI sends the request to that saved Core URL

### Requirement: Report Core and Work-runtime status
The `piwork status` command SHALL query Core health and readiness without requiring login, display the resolved Core URL and safe dependency state, and exit nonzero when Core cannot currently accept Work operations.

#### Scenario: Report a ready Core
- **WHEN** Core and its Work runtime are ready
- **THEN** `piwork status` reports both as ready and exits with status 0

#### Scenario: Report unavailable Docker
- **WHEN** Core is reachable but its Docker dependency is unavailable
- **THEN** `piwork status` identifies the runtime dependency as unavailable and exits nonzero without a stack trace

### Requirement: Log in and persist credentials safely
The `piwork login` command SHALL accept an account and obtain the password from a hidden prompt or standard input. On success it SHALL persist a versioned record containing the Core URL, token, expiration, and public identity. On POSIX systems the parent directory MUST be current-user-only and the credential file MUST be mode `0600`; unsafe targets such as symbolic links MUST be rejected.

#### Scenario: Scripted login through standard input
- **WHEN** a user runs login with an account and `--password-stdin`
- **THEN** the CLI authenticates and saves the credential without printing the password or bearer token

#### Scenario: Failed login preserves an existing credential
- **WHEN** Core rejects a later login attempt
- **THEN** the CLI reports the public authentication error and leaves any previously saved valid credential unchanged

### Requirement: Show identity and perform server-side logout
The `piwork whoami` command SHALL display the public identity associated with the saved credential. The `piwork logout` command SHALL revoke the server session and then remove the local credential after successful revocation or an already-invalid-session response; an unreachable Core MUST leave the credential available for a later retry.

#### Scenario: Use whoami in a new process
- **WHEN** a valid credential was saved by an earlier CLI process
- **THEN** `piwork whoami` authenticates without prompting and reports the same account, role, and user identifier

#### Scenario: Log out a valid session
- **WHEN** the user invokes logout while Core is reachable
- **THEN** the server session is revoked, the local credential is removed, and the old token no longer authenticates

### Requirement: Create and control Works from the CLI
The CLI SHALL provide `work create`, `work list`, `work show`, `work start`, `work stop`, `work retry`, and `work delete` commands backed by Core's authenticated lifecycle endpoints. `work create` SHALL support the installation default runtime profile and an explicit configuration file, mutation retries SHALL use stable idempotency keys, and mutation commands SHALL support waiting for their Operation to reach a terminal state.

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes the create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained data

### Requirement: Create and continue persistent conversations
The CLI SHALL provide a `chat <workId>` command that can create a new Session or continue a selected Session, submit prompts with stable idempotency keys, display ordered assistant and tool events while the Run executes, and print the terminal result. It SHALL support both an interactive loop and a single-message mode suitable for scripts.

#### Scenario: Send one scripted message
- **WHEN** a user invokes `piwork chat <workId> --message <text>` for a ready Work
- **THEN** the CLI creates or selects a Session, submits exactly one Run, displays the assistant reply, and exits according to the Run terminal state

#### Scenario: Continue an existing Session
- **WHEN** a user invokes chat with a previously returned Session identifier after Core or agentd has restarted
- **THEN** the prompt is added to the same restored Pi SDK history and the reply is associated with that Session

#### Scenario: Interrupt an active chat explicitly
- **WHEN** the user presses the documented cancellation key while observing an active Run
- **THEN** the CLI requests Run cancellation, waits for or reports its durable state, and does not treat a mere transport disconnect as cancellation

### Requirement: Inspect Sessions and Runs
The CLI SHALL provide Session list/show and Run show/watch/cancel commands so a user can recover after disconnecting from chat. Watching from a retained event cursor MUST continue the original Run without resubmitting the prompt, and an expired cursor MUST direct the user to the durable Run result and Session history.

#### Scenario: Recover after an observation disconnect
- **WHEN** chat loses its event connection after a Run was accepted
- **THEN** the CLI reports the Run identifier and the user can watch or show that Run without causing another model execution

#### Scenario: Query a completed Run
- **WHEN** a user invokes `run show` for an authorized completed Run
- **THEN** the CLI displays its terminal state and final result without contacting the model again

### Requirement: Provide stable output and failure behavior
Networked commands SHALL offer human-readable output by default and one machine-readable JSON value through `--json`. Ordinary output MUST go to standard output, diagnostics MUST go to standard error, and usage, authentication, unavailable Core/runtime, not found, failed Operation, and failed Run conditions MUST map to documented nonzero exit statuses. Passwords, bearer tokens, model credentials, and mounted secret paths MUST never appear in normal output.

#### Scenario: Request JSON output
- **WHEN** a user adds `--json` to a successful status, identity, Work, Operation, Session, or Run command
- **THEN** the CLI writes exactly one valid JSON value to standard output

#### Scenario: Reject invalid command input
- **WHEN** required arguments are missing or an option is invalid
- **THEN** the CLI prints relevant usage to standard error, exits with the documented usage status, and does not contact Core

### Requirement: Retain CLI authentication and conversation access across Core restart
A saved CLI credential SHALL remain usable after Core restarts with the same data directory while the server session remains valid. The same CLI process contract SHALL let the user query the existing Work and continue an existing Session after Core re-adopts the Work generation.

#### Scenario: Continue after Core restart without logging in again
- **WHEN** a user logs in, creates a Work and Session, Core restarts with the same data directory, and the user sends another message before login expiration
- **THEN** the CLI reuses the saved Core URL and token, reaches the recovered Work, and receives a reply in the existing Session
