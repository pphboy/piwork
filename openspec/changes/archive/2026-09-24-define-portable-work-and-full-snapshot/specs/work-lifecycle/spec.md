# Spec Delta

## ADDED Requirements

### Requirement: Fence all Work mutations during a cold snapshot

**Identifier:** WLIFE-SNAPSHOT-001

export 锁 SHALL 与其 Operation 持久关联，独占当前 Work 的 start/stop/retry/delete、配置 set/apply、服务 mutation、Session/Run mutation、存储清理以及自动恢复写入。授权和幂等 replay 检查后，新冲突 mutation SHALL 返回 409 WORK_SNAPSHOT_BUSY 而不排队或 supersede 快照；查询可继续。快照接受和其他 mutation 接受必须原子互斥：先提交的一方获准，另一方冲突。export 终结且全部 helper 已退出后释放锁；异常重启先收尾快照再开放正常恢复。管理员控制操作也不得绕过该门禁。

import 任务 SHALL 不被普通 Work 恢复、service reconciliation 或 context 孤儿清理误处理；发布后保持 stopped 且只在显式 start 后开放运行。导入不创建运行容器、网络或 TLS 文件；首次显式 start 走既有准备/启动路径，建立新的运行代次、网络和证书，不复用源代次或证书。源 agent 旧代次的恢复计数不移植到新代次；service 级恢复预算按 WSRV-SNAPSHOT-001 保留。普通非快照生命周期顺序与停止语义保持不变。

#### Scenario: Start competes with export
- **WHEN** start 与 export 并发提交
- **THEN** 仅先通过原子门禁的一方被接受，不能边写 workspace 边成功导出

#### Scenario: Administrator tries an edit during export
- **WHEN** 非所有者管理员有控制权限但 Work 正持有快照锁
- **THEN** 其配置/服务/delete 操作也返回 WORK_SNAPSHOT_BUSY，内容仍不向其开放

#### Scenario: Restore imported active context
- **WHEN** import 发布了 stopped Work 且 Core 重启
- **THEN** 不自动启动或创建运行网络/证书；显式 start 生成新身份并按 WCFG-SNAPSHOT-001 选择 context

#### Scenario: Cleanup has not stopped a helper
- **WHEN** export 失败但受信存储 helper 尚不能确认退出
- **THEN** gate 保留且诊断显示 cleanup-pending，不放行会与它竞争的 Work 写入
