# Proposal

## Why

用户希望通过对话让 Pi 选中刚完成或指定的 Service，或刷新正在查看的 Service 页面。目前 agentd 能部署、管理和查询 Service，却没有可调用的工作台视图操作；多个 Service 时仍需用户手动找到目标。

## What Changes

- 为 agentd 增加独立的 `service_select`、`service_refresh` 原生工具，遵循当前 Work 的工具策略，并提供简短使用指导，供 Agent 按用户任务需要调用。
- Select 在发起本轮对话的页面选中并展示指定 Service；Refresh 只直接重载该页面已经展示的指定 Service，目标未展示时忽略。Select 不进入专注布局，同一目标的重复 Select 不刷新页面。
- 复用现有 Run 工具完成事件传递有界结构化指令；仅本页发起并仍有效的 Run 可以触发一次视图操作，其他页面及历史读取不执行指令。
- 采用尽力执行语义：工具只报告已生成视图请求，不声称浏览器执行成功。原页面关闭、重载或离开所属 Work 后丢弃，不增加回执、持久队列、补发或跨页面接管。同一 Run 连续 Select 不保证最后一次请求必定生效。
- 刷新直接执行，不增加确认框；允许应用内未保存内容随页面重载丢失，Chat 草稿、Session 和 Run 观察仍保留。

## Capabilities

### New Capabilities

- `agent-service-view-controls`：Agent 按需请求选择或刷新当前 Work 的指定 Service，以及浏览器对原发起页面、目标身份、重复事件和失效请求的执行边界。

### Modified Capabilities

无。现有 Service 生命周期、Run 持久受理和历史读取、Service 入口授权及 Focus 布局契约继续适用；本能力以独立要求补充显式视图操作。

## Impact

- `apps/agentd/src/application.ts`、`pi-sdk-executor.ts`、`package-resources.ts` 及新增工具模块：SDK 注册、策略过滤、名称预留、Run 绑定和使用指导。
- `internal/workruntime/`：同步运行报告中两个可选原生工具的策略准入，保留旧 Agent 和未知工具拒绝边界。
- `packages/contracts/src/`：工具参数与结构化请求的共享校验；新增常量与现有七个 SDK 基础工具列表分开。
- `apps/desktop-webui/src/adapter.ts`、`app.ts` 及新增视图控制模块：登记本页提交、消费实时工具结果、复用 Service 选择和入口逻辑、定向刷新。托管工作台和独立 CLI Desktop 共用该浏览器实现。
- 复用工具结果预览及现有 Core 转发，不新增 proto 字段、HTTP 路由、history schema、Service MCP 工具或外部依赖。
- 增加 Agent/adapter 单元契约测试、双页面 Playwright 验证及真实 SDK 到浏览器的定向验收；实现阶段同步浏览器嵌入资源并重建宿主程序。部署命令、镜像默认引用、根 README 和官网不受影响。
