# Spec Delta

## MODIFIED Requirements

### Requirement: Stop the complete Work without losing data

**Identifier:** WLIFE-SERVICE-001

停止 Work SHALL 先拒绝新 Run 和服务 mutation，再进行有界 drain、取消、进程回收和容器停止，覆盖 daemon、本地 MCP 和附属服务；配置及数据保留遵循 work-storage。默认 drain 30 秒，随后终止确认期限 10 秒，均可配置；未确认停止 MUST NOT 报告 stopped。

Service shutdown SHALL occur even when the daemon container is absent, already stopped, failed readiness, or unreachable. A drain failure SHALL be recorded but MUST NOT skip attempts to stop other managed containers. All known and in-flight owned service instances SHALL be reconciled to stopped before Work reports stopped. A failed Docker stop or unresolved late creation SHALL retain an incomplete/failed Operation and explicit unknown state, not a false stopped result.

#### Scenario: Stop an active Work

- **WHEN** 用户停止具有活动 Run 和两个附属服务的 Work
- **THEN** 新提交被拒绝，所有受管进程和容器最终停止，配置与数据仍在

#### Scenario: Runtime cannot confirm shutdown

- **WHEN** 停止期限已过且容器运行时无法确认实例状态
- **THEN** Operation 保持未完成并报告依赖不可用或状态未知，不返回停止成功

#### Scenario: Stop orphaned application containers
- **WHEN** agentd has exited but two Work service containers remain running when stop is accepted
- **THEN** Core stops and verifies both services and retains their enabled definitions and files

#### Scenario: Drain fails during stop
- **WHEN** agentd cannot respond to drain
- **THEN** Core still attempts to stop all application containers and agentd and reports any unresolved shutdown failure

### Requirement: Recover desired state and adopt existing instances

**Identifier:** WLIFE-SERVICE-002

系统 SHALL 在 Core 或宿主机重启后按持久期望状态核对资源、接管匹配实例、继续未完成 Operation，并在启动新主 daemon 前确认旧实例停止。Core 优雅退出 SHALL 停止其受管 Work 容器并保留期望状态；未知归属资源 MUST NOT 被自动删除。

Graceful Core shutdown SHALL close user and runtime mutation admission, drain Work execution, stop application services and agentd, and confirm results before successful exit. It SHALL preserve desired lifecycle state, service enabled flags, definitions and persistent files. Same-version Core startup SHALL restore Works whose desired state is running and their enabled services, including service reconciliation when an agent container already exists. Abrupt Core loss SHALL leave durable intent for adoption/recovery and MUST NOT be represented as confirmed graceful stop. Unknown resources remain untouched. With the default 30-second drain and 10-second termination budgets, graceful Core shutdown SHALL have a 45-second process bound across concurrent Work stops. Exceeding it SHALL produce a nonzero exit and incomplete-shutdown diagnostics rather than a clean exit.

#### Scenario: Core restarts after container creation

- **WHEN** Core 在创建容器之后、记录结果之前崩溃并重启
- **THEN** 系统识别并接管已有实例，继续原 Operation，不创建重复容器

#### Scenario: Host restarts with running and stopped Works

- **WHEN** 宿主机重启前 Work A 期望 running、Work B 期望 stopped
- **THEN** A 被恢复，B 保持停止，二者持久身份不变

#### Scenario: Old daemon is unresponsive

- **WHEN** daemon 失联且无法确认其已退出
- **THEN** 系统关闭其路由并报告恢复阻塞，不启动第二个主写入者

#### Scenario: Graceful Core restart restores deployment
- **WHEN** Core receives SIGTERM with one running Work and one deliberately stopped Work
- **THEN** running containers are confirmed stopped before clean exit; after Core restart only the desired-running Work and its enabled services restore

#### Scenario: Recover an existing daemon with absent services
- **WHEN** Core adopts a valid agent container but an enabled application container is missing
- **THEN** Core reconciles the service from its durable definition and retained storage without asking the agent to redeploy
