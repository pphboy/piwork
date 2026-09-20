# Core Service Startup Specification

## Purpose

Defines how a local piwork installation is initialized and run as a durable Core service that can authenticate users, control Docker-backed Works, recover existing instances, and report operational state.

## Requirements

### Requirement: Bootstrap the first administrator explicitly

Core SHALL 保留显式的离线首管理员 bootstrap 命令，并额外提供受保护的在线控制面 bootstrap。`serve` 本身 MUST NOT 创建默认账号或默认密码；空安装可由显式 env 文件初始化或由 `piwork-serve admin bootstrap` 完成。管理员存在后，所有 bootstrap 入口 MUST 拒绝覆盖现有身份。

#### Scenario: Bootstrap an empty installation

- **WHEN** 操作者使用 `piwork-serve admin bootstrap --data-dir <path>` 提供账号和密码
- **THEN** Core 创建首个管理员且不输出密码或摘要

#### Scenario: Bootstrap an empty installation online

- **WHEN** Core 已由 `piwork-serve serve` 监听且操作者通过 operator credential 调用 `piwork-serve admin bootstrap`
- **THEN** Core 创建首个管理员并更新 readiness，不需要停止或重启 Core

#### Scenario: Refuse repeated bootstrap

- **WHEN** 管理员已经存在时调用任一 bootstrap 入口
- **THEN** 请求失败且现有身份数据不变

#### Scenario: Refuse repeated bootstrap (offline command)

- **WHEN** an operator invokes bootstrap after an administrator already exists
- **THEN** Core exits nonzero with a concise diagnostic and leaves the existing identity data unchanged
### Requirement: Configure a usable local runtime profile

Core SHALL 保留离线 runtime 配置命令，并提供受保护的在线全局默认配置 API。全局配置 SHALL 仅作为之后新建 Work 的默认值；已有 Work 的独立配置、模型引用和运行实例 MUST NOT 因全局配置变化而修改、重启或切换模型。

#### Scenario: Configure the global default online

- **WHEN** 管理员通过 `piwork-serve config set` 提供兼容镜像、模型、endpoint 和 secret
- **THEN** Core 持久化全局默认配置，查询只返回非敏感字段和 secret 可用性

#### Scenario: Configure an installation from standard input

- **WHEN** an operator selects an agent image and model and supplies the model credential through standard input
- **THEN** Core stores a usable default runtime profile without placing the credential in command arguments, normal output, logs, or public API responses

#### Scenario: Change defaults without changing existing Works

- **WHEN** 全局默认模型配置从 model-a 改为 model-b
- **THEN** 新 Work 使用 model-b，已有 Work 保留原独立配置且不发生隐式重启

#### Scenario: Detect an incomplete runtime profile

- **WHEN** Core starts without a usable agent image or model profile
- **THEN** health remains available, readiness reports the missing runtime configuration, and Work creation returns an actionable configuration error
### Requirement: Start one durable Core application

`serve` SHALL 在管理员和运行时配置缺失时仍打开健康 HTTP listener，初始化完成后再报告相应 readiness；配置存在时继续执行 Docker 验证和 Work recovery。它 MUST NOT 因缺少管理员或默认 runtime 而退出，也 MUST NOT 在启动过程中创建默认 Work。

#### Scenario: Start before initialization

- **WHEN** 操作者在空或部分配置的数据目录启动 `serve`
- **THEN** Core 监听健康接口，报告具体初始化状态，并允许控制面补齐缺失配置

#### Scenario: Start a configured Core

- **WHEN** 管理员、默认 runtime 和 Docker 都可用
- **THEN** Core 完成 recovery 后进入 READY，并保留已有 Work 的独立配置

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

Core 重启时 SHALL 恢复用户、会话、Work 和每个 Work 的 desired/active 配置版本。恢复过程 MUST 使用 Work 保存的配置，不得用新的全局默认配置替换已有 Work。

#### Scenario: Continue after restart with changed defaults

- **WHEN** Work A 使用 model-a，Core 停止后全局默认改为 model-b，再次启动并恢复 Work A
- **THEN** Work A 继续使用 model-a，原有 Session 可继续，且不会创建第二个实例

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
