# 验证记录

- 现场调查期间 Work 与已知 Operation 列表可读取，未复现截图中的原始 404；无法确认该截图具体是哪一个请求返回 404。
- 适配器测试模拟原 Operation 返回 404，验证保留原 Operation 身份和可用 Work，不把查询失败解释为 Work 失败；Work 本身 404 的既有测试仍分别覆盖。
- 独立安装的真实 Docker 测试 `TestNativeShutdownRestartPreservesEnabledAndDisabledServices` 通过，验证正常关闭后恢复 Work 与 Service；测试按本次精确 installation ID 清理。
- 进程崩溃接管测试因本机 7172 被现有 Core 占用而无法启动；未停止或修改现有 Core，网络命名空间隔离在本环境被拒绝。
- Desktop 构建和嵌入资源同步通过；指定 Node 24 运行适配器、布局、双语和生命周期等 75 项针对性测试通过，另有恢复工具栏与操作历史浏览器场景通过。初次运行时 `browser.test.js` 触发 Node 内部断言；完成宿主程序构建后用 Node 24 单独重跑，该文件通过。
- `TestNativeWorkObservationDuringSlowRestartRecovery` 在隔离安装中注入一次恢复失败并延缓后续恢复，验证 Work 未确认、HTTP 查询不阻塞及真实 Agent 恢复到 Ready；测试使用本次精确 installation ID 清理。
- 在隔离 Core 及托管浏览器上，注入恢复失败、延迟重试并开放真实 Agent 恢复：浏览器先显示 Work 状态未确认，Core 确认后无需刷新自动显示 Ready；测试通过。原 Core 及其 Docker 资源未改动。
- 扩展为两个 Work 的隔离真实浏览器恢复测试通过：两行先显示未确认，失败重试后均自动更新为 Ready。
- Node 24 不含 onboarding 的浏览器回归运行 1018 项，1016 项通过；剩余两项属于同一个等待动画测试，首次因 Console 资源未构建失败，补齐构建后该测试全部 7 项单独重跑通过。真实 onboarding 因既有 Core 占用 7172 未运行；已用隔离端口和真实浏览器验证恢复主路径。
- `go test ./internal/cli ./internal/coreapp`、原生边界检查、宿主程序构建、OpenSpec 严格校验及 `git diff --check` 通过。
- 针对两项验证警告，Desktop 生命周期适配器测试 32 项通过，覆盖状态请求挂起超时、离开列表及身份切换取消、手动重查、晚响应与待恢复/失败动作；Core 启动测试覆盖最新代次、旧失败、耗尽重试、停止目标以及重试次数和截止时间保持，重试预算存储测试通过。
- 针对自动重试期间误报失败的警告，Go 测试覆盖三次已安排重试、耗尽后的失败、停止目标、旧代次和无代次；浏览器测试覆盖 Core 就绪时等待重试并自动更新到 Ready。独立安装的真实浏览器测试通过：注入一次恢复失败，等待计划重试，并观察两个真实 Work 自动恢复至 Ready；该测试按本次 installation ID 清理。
