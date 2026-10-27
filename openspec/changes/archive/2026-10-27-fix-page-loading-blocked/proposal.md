# Proposal

## Why

MicroVM 的端口转发并发连接失败会让浏览器模块图中断，三个网页入口缺少完整的启动失败检测与恢复，因而可能一直停在 Loading。即使模块已经运行，管理入口和登录／引导入口的首读悬挂也会阻止用户继续操作。

## What Changes

- 为 Desktop、管理和登录／引导三个入口建立独立于应用模块图的启动监测、有限自动恢复和始终可用的手动恢复入口。
- 为启动阶段的会话和状态读取提供有界超时、只读重试及明确的未确认状态，保证合法导航可用；忽略过期响应，防止旧读取覆盖新视图。
- 工作区进入后按受影响区域局部恢复，保留当前草稿、焦点和导航；写入结果未知时先核对实际结果，不自动重发写操作。
- 覆盖托管与独立 Desktop、Admin 及登录／首次引导的资源失败、请求悬挂和网络恢复，并与 MicroVM 修复联合作实际端到端验收。
- 保留现有中英文语言、认证、权限、URL 和安全边界，不引入新的产品端口或运行依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ui-language`: 定义三个浏览器入口的启动检测、有限自动恢复和不依赖外部脚本的手动恢复。
- `desktop-webui`: 定义 Desktop 首读超时及进入工作区后的局部恢复和草稿保护。
- `serve-ui`: 定义管理入口首读超时、导航和安全恢复。
- `web-onboarding`: 定义登录／首设状态读取超时及创建／登录结果未知时的恢复。

## Impact

涉及 `apps/ui-shared/`、`apps/desktop-webui/`、`apps/console-webui/` 的 HTML、启动及读取逻辑、语言资源和浏览器测试，及 `internal/webapp/`、`internal/consoleapp/`、`internal/cli/` 的 CSP 和嵌入资源构建。不会改变业务 API 或自动重放写操作。MicroVM 的 QEMU／libslirp 转发修复在 `piwork-microvm` 仓库同名 `fix-page-loading-blocked` 变更中规划；完整消除本次复现需要两侧修复及联合验收。
