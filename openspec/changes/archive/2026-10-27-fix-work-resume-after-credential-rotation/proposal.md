# Proposal

## Why

模型 API Key 轮换后，旧 Work 恢复会读取最新凭证，却复用保存着旧凭证的 Agent 运行代次；同代次凭证不可变校验因此拒绝启动，错误表现为 `RUNTIME_START_FAILED`，用户无法打开 Work 内容。需要协调凭证轮换、运行实例接管与停止后启动，使现有 Work 能在保留配置和历史的情况下恢复。

## What Changes

- 区分接管运行中的 Agent 与重新启动 Agent：匹配且通过完整 readiness 验证的运行实例保留原代次和已有挂载，不因 Key 轮换被重建。
- 重新启动前检查凭证材料；凭证相同保留原代次，凭证变化且旧实例已确认停止/不存在时，收尾旧实例并持久创建新代次、实例身份和固定启动凭证绑定。
- 将正常凭证变化与材料损坏、权限或身份错误分开；继续禁止同代次覆盖凭证，不使用旧 Key 回退执行新 Run。
- Start、Retry、Core 启动恢复及定时恢复共享判断；切代可在崩溃后继续，遵守控制版本、停止、快照及文件任务栅栏，不产生重复 Agent 或重置自动恢复预算。
- 保留 active context、固定镜像、持久卷、Session/Run 历史和 pending Apply；轮换不主动重启 Work，已有每 Run 固定绑定及当前 Key 准入行为保持。
- 增加合成凭证的单元、Docker 和 Core 进程恢复验收，验证旧 Key 被拒绝时仍能恢复及执行新 Run。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ai-model-management`：补充 Key 轮换后运行实例接管和停止后启动的行为，保持新 Run 使用当前 Key、已接受 Run 保持原绑定。
- `runnable-work-runtime`：明确启动凭证与运行代次绑定、只读材料检查及运行实例无改写接管。
- `work-lifecycle`：明确凭证变化触发的持久切代、栅栏、崩溃恢复和跨代次重试预算。

## Impact

- `internal/internaltls/config.go`：安全检查现有代次凭证、分类凭证变化并保留不可变写入规则。
- `internal/workruntime/runtime.go`：区分已有运行实例接管与材料发布/容器启动，复用完整 readiness 校验。
- `internal/coreapp/work_start.go`、`work_coordinator.go`、`work_start_capture.go`、`work_recovery.go`、`file_lifecycle.go` 和 `work_apply.go` 的共享清理入口：解析启动绑定、协调切代及精确实例收尾；`log_archive.go` 按实际启动绑定补充原实例的凭证脱敏输入。
- `internal/corestore/runtime_generation.go` 及现有控制元数据事务：持久启动绑定、切换目标与恢复预算移交。
- 相关 Go 单元/集成测试，以及既有 `apps/agentd/src/run-models.ts`、`pi-sdk-executor` 凭证绑定测试作为回归依据。预计不修改公开 HTTP/proto、Agent 握手版本、管理表单或固定 Agent 镜像，也不新增宿主运行依赖。
- 本变更仅修复当前受支持格式的恢复行为；不导入真实凭证/数据、不执行历史格式迁移、不扩展为 UI 离线读取、镜像发布或凭证热覆盖。
