# Work Services Specification

## Purpose

使 Work 内的 agent 能自主声明和管理附属容器服务，把服务定义作为 Work 的持久配置，并保证启停、重试、更新和控制服务恢复后仍按定义运行与保留数据，而不依赖重复的对话部署步骤。

## Requirements

### Requirement: Declare services through Work-scoped agent tools

系统 SHALL 向 agent 提供创建、列出、检查、修改、重启、启用、禁用和删除服务的工具；授权及配额允许的请求不要求用户逐个手工操作容器。所有者和有控制权限的管理员 SHALL 能通过受保护 API／Console 查询和管理这些服务。

#### Scenario: Agent adds a service

- **WHEN** 当前 Work 的有效 daemon 提交合法笔记服务定义
- **THEN** 系统接受创建，返回稳定 service_id 和 operation_id，agent 能查询实际结果并使用 Work 私有服务端点

### Requirement: Persist a complete reproducible service definition

接受的服务定义 SHALL 持久保存 Work 内唯一身份/名称、版本、镜像引用、启动参数、配置引用、挂载、内部端口、资源限制、enabled 和恢复/readiness 策略。定义及 Operation SHALL 在对外承诺接受和创建运行实例前持久化；镜像首次解析成功后 SHALL 在创建实例前持久绑定固定制品身份，同 revision 后续使用该身份。停止后定义 SHALL 仍能查询。

#### Scenario: Definition survives agent loss

- **WHEN** Core 接受定义后 agent 崩溃
- **THEN** 定义和 Operation 仍存在，Core 可以完成或报告失败，无需 agent 重复声明

#### Scenario: Image resolution fails

- **WHEN** 定义已接受但镜像无法拉取或解析
- **THEN** 服务保留 failed 状态及原因，不能报告 ready，修复后可显式 retry

### Requirement: Idempotent mutations and crash adoption

服务 mutation SHALL 使用幂等键，更新 SHALL 检查预期定义版本。相同键相同内容返回原结果，异内容或过期版本返回冲突；Core 恢复后 SHALL 识别已创建的匹配实例，不能因结果未保存而重复创建。

#### Scenario: Repeat a create request

- **WHEN** agent 未收到响应而用相同键重试创建
- **THEN** 系统返回同一服务和 Operation，仅存在一个对应实例和一份配额预留

#### Scenario: Crash between instance creation and result recording

- **WHEN** Core 在容器已创建但未记录完成时崩溃并重启
- **THEN** 系统接管该容器并恢复操作状态，不创建第二个服务实例

#### Scenario: Concurrent definition updates

- **WHEN** 两个更新使用相同旧 revision，而其中一个已成功
- **THEN** 后一个更新返回冲突，不能覆盖已接受的新定义

### Requirement: Restore enabled services with their Work

服务 SHALL 仅在 Work 期望 running 且定义 enabled 时运行。Work 停止 SHALL 停止其全部服务但保持 enabled；Work 再启动 SHALL 自动恢复已启用服务及持久挂载，不依赖 agent 重放历史创建调用。

#### Scenario: Restart a Work with application data

- **WHEN** 一个启用服务已经写入持久数据，Work 停止后再启动
- **THEN** Core 使用同一 service_id、定义版本和持久卷恢复服务，原数据可读

#### Scenario: Configure services while stopped

- **WHEN** 所有者为 stopped Work 添加或启用服务
- **THEN** 定义被保存但容器不启动，下一次显式启动 Work 时才运行

### Requirement: Distinguish restart disable and removal

restart SHALL 只作用于已启用且 Work 正在运行的服务，不改变长期 enabled；对 stopped Work 或 disabled 服务的 restart SHALL 返回前置条件错误。disable SHALL 持久设置不启用并停止实例，enable SHALL 设置启用并按 Work 状态运行。remove SHALL 阻止未来恢复并按 work-storage 处理数据。

#### Scenario: Disable and restart the Work

- **WHEN** agent 禁用服务后用户停止并重新启动 Work
- **THEN** 服务保持 disabled 且无运行实例，其他启用服务正常恢复

#### Scenario: Remove a service and recover Core

- **WHEN** 服务被删除但清理尚未完成时 Core 重启
- **THEN** 系统继续清理该服务，不能把删除记录解释为缺失实例而重新创建

### Requirement: Apply service changes with explicit availability and history

更新服务 SHALL 保存新 revision、显示 desired/applied 版本，并在替换前停止旧实例，允许更新期间服务不可用。失败 SHALL 保留新错误及旧配置历史；回退配置 MUST NOT 被宣称为应用数据回滚。

#### Scenario: New service image fails

- **WHEN** 更新到的新镜像无法启动
- **THEN** 服务报告新 revision 失败和未应用状态，用户可选择旧内容作为新 revision 恢复，持久数据不自动回滚

### Requirement: Enforce quotas atomically

系统 SHALL 在接受服务定义或资源增长前核对最大服务数、Work 及宿主 CPU/内存预算，并拒绝超额请求且不创建资源。预算 SHALL 包括 agent 和启用服务；stopped Work 的启用定义仍保留预算。禁用、缩容或删除 SHALL 在实际占用已释放后才能释放对应预算。

#### Scenario: Concurrent requests exceed remaining budget

- **WHEN** 两个合法创建分别能装入剩余配额但合计超额
- **THEN** 最多接受可容纳的请求，另一请求返回配额错误，不留下重复或负配额

#### Scenario: Disable has not yet stopped the container

- **WHEN** 禁用服务已接受但其容器仍运行，新请求试图使用其预算
- **THEN** 系统仍计算未释放占用，直到确认停止后才允许重用预算

### Requirement: Report readiness and recover failures within bounds

服务 SHALL 暴露 pending/starting/ready/stopped/disabled/recovering/failed/deleting 等可区分状态、期望及已应用版本、Operation 和最近错误；readiness 超时默认 120 秒且可配置。自动恢复 SHALL 遵循可查询且持久的预算，默认同 work-lifecycle 的 3 次/10 分钟规则，不因 Core 重启清零。

#### Scenario: Container is running but not ready

- **WHEN** 容器进程存在但声明的 readiness 检查一直失败直到超时
- **THEN** 服务报告启动失败而非 ready，非必需服务故障使 Work degraded，agent 保持修复入口

### Requirement: Lifecycle changes fence late service operations

Work 进入 stopping 或 deleting 后 SHALL 拒绝新的服务 mutation。已经接受的服务操作 SHALL 遵循最新 Work 期望状态，在停止过程中创建的实例必须被停止，不能把 Work 拉回 running。

#### Scenario: Stop races with service creation

- **WHEN** 服务创建已接受但尚未完成，随后 Work 接受停止
- **THEN** 服务定义按其已接受内容保留，晚到实例被停止，旧 Operation 被标记 superseded 或停止目标下的明确结果
