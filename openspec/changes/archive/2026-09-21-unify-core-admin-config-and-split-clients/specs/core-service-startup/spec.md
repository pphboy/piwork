# Spec Delta

## MODIFIED Requirements

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
