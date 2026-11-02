# Design

## Context

见 proposal.md。初始清单来自候选 `99228aca2aa01ead78eb6a251e3929dc20368d80` 的真实集成：452 PASS、16 个顶层 FAIL、6 SKIP；子测试失败不重复计数。没有基线执行证据，不能称为全部旧问题。本规划未运行修复后验收。

源码已核对：`runs.ts:286–305` 在 drain 超时后 abort 并再等最多 2 秒，但 Promise race 返回不区分未 settled；`daemon.ts:127–139` 持有准入栅栏。`dockerengine/resources.go:285–300` 对 Service 强制 Memory=0，旧集成却期待 64MiB；`agent-conversation` 当前要求同 Session 新 Run 使用当前 active context，不要求旧 Session 拒绝继续。`nativeApplyFixture` 共用 5 分钟上下文；Skill 的 generic storage error 出现在等待原 Apply 读操作处，不足以证明重启存储损坏。

## Goals / Non-Goals

**Goals:** 有界确认 drain、正确区分恢复观察与真实完成；使固定 16 项按实际有效契约获得可重现结果，并保留跨 Work、原请求、原 Run 和资源归属保护。

**Non-Goals:** 不回退 Session 新语义、不降低安全约束、不升级生产数据格式、不全仓重构、不增大默认关闭预算、不改 UI 设计或原变更历史证据。

## Decisions

1. **契约优先而非结果优先。** 缺镜像用可追溯真实旧构建或明确不兼容合成夹具，不能将当前镜像改标签冒充旧实现。Service Memory=0、当前 schema、WORK_BUSY HTTP 状态、同 Session 新 Run 均核对权威源再修改断言；保留内容、幂等和拒绝副作用的原检查。
2. **状态归原 owner。** Agent Run/daemon 唯一管理接受和执行结束；`application.ts:495–498` 当前无条件返回 drained=true，RPC 必须只投影已确认/未确认结果；Go workruntime/coreapp 负责剩余预算、容器核验、Operation 和其他 Work 并行收尾。不以放宽上层成功条件掩盖未结束执行。优先复用现有错误/响应协议；若必须改变协议，明确兼容性并按 make generate 同步，不能只改一端。
3. **恢复测试等待真实目标。** Application 启动是异步的，先读既有有界 readiness/目标 Work 状态，再验证精确服务、文件收尾、数据和历史；不写固定 sleep、不把全局 Ready 当每个 Work 已恢复。失败输出只记录安全 phase/outcome/context deadline/原操作状态，禁止完整秘密或用户文件。
4. **未知项有限追因。** 迁移 stop、临时清理、Skill Apply、process diagnostics 分别补充原失败点所缺的证据及确定性 barrier，再作最小修复；不得先改超时、吞错误或删除断言。有效规格已覆盖的行为不另设平行规则。

### 有限失败清单与初始分类

| # | 既有测试 | 初始定位；非完成结论 |
|---|---|---|
| 1 | `TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence` | 夹具缺失 |
| 2 | `TestRealManagedResourceLifecycleAndOwnership` | 有效 Service 内存契约断言 |
| 3 | `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior` | 有效 Session 续聊契约断言 |
| 4 | `TestNativeCoreWebDAVUploadStopApplyRevocationAndRestart` | 恢复 readiness 观察 |
| 5 | `TestNativeMemoryMigrationProcessRecoveryAndStopSupersession` | 迁移 stop 未决 |
| 6 | `TestNativeSchema4ConversationUpgradeRollbackAndDowngradeFence` | 当前 schema 断言 |
| 7 | `TestNativeSchema4ExperienceUpgradeRollbackAndDowngradeFence` | 当前 schema 断言 |
| 8 | `TestNativeCoreProcessHealthIdentityRestartWithoutHostTools` | 安全诊断分类未决 |
| 9 | `TestNativeChatModelSelectionRunsThroughGoAndRealSDK` | 有效 busy 拒绝契约断言 |
| 10 | `TestNativeSDKDeploysServiceThroughGoMCPAndCore` | 恢复 readiness 观察 |
| 11 | `TestNativeServiceRevisionsCounterAndRemoval` | 恢复 readiness 观察 |
| 12 | `TestNativeCancelledCheckpointHistoryAfterEventCompaction` | 当前 schema 断言 |
| 13 | `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain` | drain 真实确认 |
| 14 | `TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations` | 有效 Session/Run 导入契约断言 |
| 15 | `TestNativeTemporaryCleanupRetriesAfterEngineReturns` | 临时清理 requested 未推进 pending/DOCKER_UNAVAILABLE，request.succeeded 非清理完成 |
| 16 | `TestNativeSkillFailuresRemainSpecificAfterRollbackAndCoreRestart` | Skill Apply 原操作读取遇五分钟 deadline；尚未到 reopen |

独立于 TS Promise race，Core 路由关闭链存在提前 Revoke/Close、后续 drain 无原连接可用的风险路径；该项由 Go owner 核对并修复，不能只修 Agent 后宣称 drain 链完成。准入撤销与 transport 关闭必须分离：先撤销新请求，按原 Work/代次保留唯一 drain receipt/连接所有权，drain 和停止确认结束后才关闭，失联不能伪造成已 drain；不新增跨 Work 全局成功标志。Core 恢复还须检查现有 `internal/coreapp/work_recovery.go` 及实际 RPC routes 的 drain receipt 消费，按原 Work/代次关联，不能借全局布尔量跨目标确认。另保留已知 Service iframe Stop→Start 偶发的有限诊断：只记录 entry/DOM 代次与受控事件顺序；无根因不加重试/超时、不扩大 UI 改造。

## Risks / Trade-offs

- [异步时序使错误归因失真] → 原阶段安全诊断、确定性 barrier、同一原操作观察，保留失败样本。
- [drain 改动影响取消和并发提交] → 空闲、正常结束、abort 后仍运行、重复 drain、迟到回调、跨 Work 及身份负例直接测试，再做真实容器停止。
- [全量 Engine 验收耗时及外部依赖] → 先分组快速定位再全量；明确环境/镜像来源和 skip 条件，禁止把局部通过写成全量通过。

## Migration Plan

不计划存储迁移或发行。规划、契约/夹具、Agent drain、必要 Core 修复及跨组件验证按依赖组织提交；对应测试和生成物跟随功能提交。回退按功能提交执行，不能删除用户安装或强行解锁未知任务。实现完成后单独提交审阅，不自动合并、归档或发布。

## Open Questions

四项未决失败的原阶段证据仍需在 apply 中取得；这不改变已有契约或有限测试边界。若证据要求改变公开语义、预算或持久格式，停止该项并修订规划，不默默扩大范围。

## 修复候选的全量验证调度

仅完整 `integration-go` 使用固定 `core-repair-v1` 并发组，并由新修复候选替代同组过时运行；其取消结果必须记为未完成，不能视为通过。其他验证组不自动取消，旧 UI 文档候选的不同并发组不受影响。集中发布相关修复后冻结最终候选，必须等待最终 SHA 的完整 Go 套件真实终态，不以目标组或被取消运行替代验收。
