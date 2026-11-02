# Spec Delta

## MODIFIED Requirements

### Requirement: Stop the complete Work without losing data

**Identifier:** WLIFE-SERVICE-001

停止 Work SHALL 先拒绝新 Run 和服务 mutation，再进行有界 drain、取消、进程回收和容器停止，覆盖 daemon、本地 MCP 和附属服务；配置及数据保留遵循 work-storage。默认 drain 30 秒，随后终止确认期限 10 秒，均可配置；未确认停止 MUST NOT 报告 stopped。

Service shutdown SHALL occur even when the daemon container is absent, already stopped, failed readiness, or unreachable. A drain failure SHALL be recorded but MUST NOT skip attempts to stop other managed containers. All known and in-flight owned service instances SHALL be reconciled to stopped before Work reports stopped. A failed Docker stop or unresolved late creation SHALL retain an incomplete/failed Operation and explicit unknown state, not a false stopped result.

Agent drain SHALL 先关闭新 Run 准入；返回有界等待并不等于所有执行已结束。取消期限后仍有执行或子进程未确认结束时，系统 MUST NOT 将 drain 作为已完成的成功证明；Core SHALL 继续按原预算停止并核验精确容器，保留 drain 未确认诊断，不能因 RPC 已返回而跳过终止确认。迟到完成不得重新开放准入、覆盖较新的 Stop/Delete/Apply 或恢复旧执行。

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

#### Scenario: 取消后仍未结束的执行
- **WHEN** drain 等待耗尽且取消后执行或子进程仍未确认结束
- **THEN** 不返回虚假 drain 完成证明；Core 继续停止精确容器和其他受管资源，保留未确认诊断，停止结果只按真实确认和原预算判定

#### Scenario: drain 后迟到完成
- **WHEN** 原执行在停止或替换目标已接受后才返回
- **THEN** 原执行不能重新开放新 Run 准入或覆盖新的控制目标，历史结果仍绑定原 Run
