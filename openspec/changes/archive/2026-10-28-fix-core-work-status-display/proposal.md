# Proposal

## Why

Core 启动恢复时，Desktop 将可读的未就绪响应归为不可用，缺少真实的启动反馈；Work 行可能显示旧状态或附带历史操作文本，使当前状态难以辨认。

## What Changes

- 区分 Core 启动恢复、真实未就绪、不可达和读取未确认，并自动更新；依据已确认原型在工具栏轻量展示启动状态。
- 让 Work 自动恢复期间的状态及快捷动作跟随当前确认事实，避免把旧 Ready 或 Stopped 作为当前结果。
- Work 行不再常驻已结束 Create、Start、Retry 等操作文本；保留原操作详情及必要的未确认恢复入口。
- 排查截图中 404 的具体查询来源，按真实结果区分对象缺失与读取未确认，不推断操作失败。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`: Core 状态、Work 列表恢复状态、操作记录与当前状态的展示和自动刷新。
- `core-service-startup`: Core 启动恢复的可观察状态与 Work 恢复期间旧观测的确认边界。
- `ui-language`: 确认的 Core 启动状态圆环作为统一等待动效的局部例外。

## Impact

涉及 Go Core 恢复、Desktop 状态适配与 WebUI、双语文案、嵌入资源及相关单元、浏览器和集成测试；不改变 Work 持久数据、操作身份或发布流程。
