# Proposal

## Why

新建 Session 受理后，前端可能一直等待未发起的历史读取，导致空会话停留在骨架屏。现有列表也缺少持久命名和删除能力，用户难以管理多段对话。

## What Changes

- 修复创建成功和原创建结果恢复后的会话打开流程；分别呈现创建、读取、已确认空会话和读取失败，保留原提交核对与草稿。
- 为 Session 提供持久 Rename、首轮回复后模型自动命名，以及手动触发的 Auto name；手动名称不被迟到的自动结果覆盖。
- 提供明确确认的逻辑删除：从列表移除并禁止继续该 Session，保留原历史、执行证据、Work 文件和 Memory；目标有活跃 Run 时拒绝删除；删除当前会话确认后创建并选择新 Session。
- 将会话列表的 New 改为标题右侧紧凑按钮，并在每行提供 Rename、Auto name、Delete；具体列表视觉方案以原型试用结果为准。
- 扩展 Agent、Core 和 Desktop 的持久元数据与能力协商，兼容旧 Agent、Work 历史和导入导出；不自动替换运行镜像。
- 将当前 history 契约明确为 schema 8，补齐 schema 4–7 的静态兼容、显式 Apply 升级及回滚条款；Memory 保持 schema 1。修正本变更新增的源码格式违规，不改变业务行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-conversation`: 增加持久标题、自动命名、逻辑删除及与 Run、证据和历史兼容的约束。
- `desktop-webui`: 修复新建空会话的加载状态，提供标题和删除操作及失败恢复。
- `desktop-ui-language`: 更新会话标题与操作的界面行为，保持原有 Run 观察和草稿约束。
- `portable-work`: 精确接受 schema 4–8，保留 schema 8 的标题、删除标记、原管理回执和 Memory 证据闭包，离线导入不升级。
- `work-memory`: 将当前受管 history 及显式升级目标更新为 schema 8，保持 Memory schema 1 和既有备份、恢复及旧镜像拒绝规则。
- `runnable-work-runtime`: 将已有 readiness 的精确受支持 history 声明补齐为 4–8，当前 Agent 为 8。
- `native-runtime-distribution`: 对齐容器内 Agent 现行 history 版本及旧格式识别范围，保持原平台与运行时边界。

## Impact

涉及 `apps/desktop-webui`、`apps/agentd`、`packages/work-store`、`packages/contracts`、`proto/agent.proto` 和 `internal/coreapp` 的会话链路，以及 Work history schema 8、导入导出校验及生成物。模型命名需要受控模型调用和明确的失败、并发处理。UI 资源构建后需同步嵌入 Go；需执行对应单元、契约、浏览器及真实 Core 集成检查。格式收口使用既有增量检查，不新增 formatter 或全仓重排。
