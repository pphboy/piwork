# Proposal

## Why

当前 Core 集成把大量独立安装测试放在单个 Go 包内顺序执行，并在全量之前重复执行原 16 项目标；测试进程还争用生产默认 RPC 端口，Agent 关闭存在未清理的兜底定时器。用户要求缩短验收反馈，同时测试正确性、覆盖和完成判定不与特定机器的 CPU、内存、并发数或绝对耗时绑定。

## What Changes

- 保留 `make test-integration-go` 完整入口，建立一次发现、一次分配、一次执行、统一汇总的全量运行；原 16 项作为必须通过的子集核对，不在同一最终候选上重复运行。
- 以独立 Go 测试进程承载可配置分片，支持显式正整数并发和可降级的自动策略；同一测试清单在不同机器或并发配置下具有相同覆盖与通过标准。
- 统一 Core 测试启动夹具的安装级动态 RPC 端口与真实回连地址，跨同安装重启保持端口关联；保持生产默认 7172 和现有三个运行参数。
- 在同一生命周期 owner 清理提前完成等待所遗留的定时器，保留真实 drain、取消、停止确认和故障期限。
- 从实际 `go test -json` 事件生成进度及终态；缺失、重复、异常退出、超时、中止、输入漂移和未解释的条件 skip 均不能形成完整通过证据。
- 对构建、准备、测试和清理分别计时，用同环境、同候选、同覆盖的对照评估收益；不设某台机器专属的分钟指标或固定 worker 数。

## Capabilities

### New Capabilities

- `core-integration-test-execution`: Core 集成的可移植调度、完整覆盖证据、动态测试端口、共享制品准备、取消清理和耗时报告契约。

### Modified Capabilities

无。现行 Work 生命周期和有效 drain delta 的产品行为、30/10/45 秒默认预算、真实 SDK/Engine 与历史兼容场景均保留；本次资源清理修正不改变它们的要求。

## Impact

责任入口为 `Makefile`、`scripts/` 的构建与测试运行器、现有 `.github/workflows/pr4-webui-verification.yml`、`internal/testsupport/`、Core 进程测试夹具、`scripts/native-test-server.mjs` 及其浏览器消费者；RPC listener 的窄资源接线归 `internal/coreapp/service_rpc.go`，Agent timer 归 `apps/agentd/src/application.ts`。只沿这些真实依赖同步，不新增通用测试框架或生产运行配置。

实施将复用现有维护检查与相关直接、进程、真实 Engine 测试。`repair-core-integration-and-drain-contracts` 的原 16 项及其 5.2 是证据消费者，新门禁结果必须保留旧失败、条件与真实候选身份。本轮仅创建本 change 的规划，不修改旧任务状态、主规格、源码或运行中的旧门禁，也不提交、归档或发布。
