# Proposal

## Why

当前候选真实 Engine/Core 全量集成仍有 16 个顶层失败，浏览器和局部真实链通过不能代替这些结果。需要在独立后端变更中修复已确认的契约/夹具漂移以及实际恢复、drain 问题，避免误报正常关闭、错误重绑历史或为绿灯放宽断言。

## What Changes

- 以失败清单逐项核对有效规格、源码、原操作及真实资源，区分过期断言、缺失合成镜像和产品缺陷；未执行基线不声称失败早已存在。
- 明确 Agent drain 的有界返回不是所有执行已结束的证明；保留 Run 准入栅栏、取消结果和最终容器停止证明，失败不跳过其他 Work/Service 收尾。
- 修复范围限于清单对应的 Session/context、迁移/停止竞争、Core 重启恢复、文件/临时资源收尾及诊断；修正测试必须有当前有效契约依据，保留原身份、权限、请求数和未知锁。
- 先运行目标真实 Engine/Core 分组，再运行全量集成及必要 Go/TS、浏览器、生成一致性回归；不删失败、不改成跳过、不伪装历史镜像。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `work-lifecycle`: 补充 drain 未完成及迟到执行的停止确认语义；既有 30/10/45 秒预算、持久期望状态、未知资源保护不变。

其余失败按现行 `work-services`、`agent-conversation`、`work-configuration`、`work-snapshots`、`work-memory` 和运行分发契约修复，不另行修改产品需求；若发现契约冲突，先报告并修订本规划，不以实现猜测替代规格。

## Impact

主要 owners 为 `apps/agentd/src/{daemon,runs,application}.ts` 及其实际 RPC 接线、`internal/{coreapp,workruntime,dockerengine,corestore}` 的相关生命周期/恢复路径与集成测试；按证据触达，不整体重写。构建夹具及既有 CI 分组可同步，协议改变才运行原生成链。无 UI 重新设计、默认预算增长、真实用户数据迁移、主规格同步、归档、合并或发布授权；规划提交与功能/对应测试/生成物按职责分组。
