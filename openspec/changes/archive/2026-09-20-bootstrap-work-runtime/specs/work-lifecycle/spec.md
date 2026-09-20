# Spec Delta

## Purpose

定义 Work 作为持久运行单元的创建、查询、启动、停止、删除和故障恢复契约，使用户能够跟踪异步操作，并在客户端、控制服务或容器中断后获得一致的状态，避免重复实例和停止后误恢复。

## ADDED Requirements

### Requirement: Durable asynchronous Work operations

系统 SHALL 通过 CLI 和受保护 API 接受 Work 创建、启动、停止、重试与删除，提供 Console 状态和控制入口。接受的 mutation SHALL 返回稳定 Work ID 和可查询 Operation，持久保留期望状态、步骤结果和失败原因；资源完成前 MUST NOT 报告就绪。

#### Scenario: Create and observe

- **WHEN** 已登录用户提交有效 Work 创建配置
- **THEN** 系统返回 Work ID 和 Operation ID，用户能观察准备、启动以及成功或具体失败结果

### Requirement: Idempotent and ordered lifecycle mutations

系统 SHALL 对 mutation 接受幂等键，同主体、同操作和同键的相同请求返回原结果，不同内容返回冲突；Work 内相互冲突的操作 SHALL 按持久版本排序，最新接受的期望状态取代旧目标并使旧 Operation 可观察地 superseded。

#### Scenario: Lost creation response

- **WHEN** 创建响应丢失后用户用相同键和内容重试
- **THEN** 系统返回同一 Work 和 Operation，不额外创建 Work 或 daemon

#### Scenario: Stop while starting

- **WHEN** Work 启动尚未完成时接受停止请求
- **THEN** 系统以停止为最新目标，收尾已创建资源，旧启动操作不能覆盖停止目标

### Requirement: Work readiness and partial service failure

Work SHALL 在有效 daemon 完成配置加载、历史恢复和必要初始化后开放对话；附属可选服务失败但 agent 可用时 SHALL 报告 degraded 和逐服务错误。单 Work MUST NOT 存在两个有效主 daemon。

#### Scenario: Optional service fails

- **WHEN** agent 初始化成功但一个非必需服务启动失败
- **THEN** Work 显示 degraded，用户仍可连接 agent 查询和修复该服务

#### Scenario: Required initialization fails

- **WHEN** 必需 Skill、MCP 或兼容运行环境初始化失败
- **THEN** Work 不报告 ready，返回对应诊断且不接受 Run

### Requirement: Stop the complete Work without losing data

停止 Work SHALL 先拒绝新 Run 和服务 mutation，再进行有界 drain、取消、进程回收和容器停止，覆盖 daemon、本地 MCP 和附属服务；配置及数据保留遵循 work-storage。默认 drain 30 秒，随后终止确认期限 10 秒，均可配置；未确认停止 MUST NOT 报告 stopped。

#### Scenario: Stop an active Work

- **WHEN** 用户停止具有活动 Run 和两个附属服务的 Work
- **THEN** 新提交被拒绝，所有受管进程和容器最终停止，配置与数据仍在

#### Scenario: Runtime cannot confirm shutdown

- **WHEN** 停止期限已过且容器运行时无法确认实例状态
- **THEN** Operation 保持未完成并报告依赖不可用或状态未知，不返回停止成功

### Requirement: Recover desired state and adopt existing instances

系统 SHALL 在 Core 或宿主机重启后按持久期望状态核对资源、接管匹配实例、继续未完成 Operation，并在启动新主 daemon 前确认旧实例停止。Core 单独退出 SHALL 保留现有 Work 容器；未知归属资源 MUST NOT 被自动删除。

#### Scenario: Core restarts after container creation

- **WHEN** Core 在创建容器之后、记录结果之前崩溃并重启
- **THEN** 系统识别并接管已有实例，继续原 Operation，不创建重复容器

#### Scenario: Host restarts with running and stopped Works

- **WHEN** 宿主机重启前 Work A 期望 running、Work B 期望 stopped
- **THEN** A 被恢复，B 保持停止，二者持久身份不变

#### Scenario: Old daemon is unresponsive

- **WHEN** daemon 失联且无法确认其已退出
- **THEN** 系统关闭其路由并报告恢复阻塞，不启动第二个主写入者

### Requirement: Bounded recovery and explicit deletion

自动恢复 SHALL 使用可查询且跨 Core 重启保留的预算，默认 10 分钟内最多 3 次、退避 1/5/15 秒，连续 ready 10 分钟才重置；耗尽后返回失败并提供显式 retry。删除 SHALL 先收尾实例再完成，默认保留数据，显式清理由 work-storage 规定。

#### Scenario: Repeated crash and Core restart

- **WHEN** daemon 持续崩溃直至预算耗尽，期间 Core 重启一次
- **THEN** 重启不清空计数，Work 停止自动恢复并报告失败，用户可显式 retry

#### Scenario: Deletion interrupted

- **WHEN** 删除 Work 的过程中 Core 重启
- **THEN** 系统继续原清理 Operation，资源确认移除前不报告 deleted，不重新启动该 Work
