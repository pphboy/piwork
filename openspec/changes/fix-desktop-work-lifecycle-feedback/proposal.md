# Proposal

## Why

Desktop 的创建与停止 Work 主路径存在状态映射、原 Operation 关联和终态刷新缺口，用户会看到准备中的 Work 显示 Unknown、操作已完成但列表仍停在旧状态，以及按钮与当前目标不一致。通用请求完成记录又持续堆积成 `Work · 路径 · Checked · ISO 时间` 提示，占用实际工作区域，影响基础使用。

## What Changes

- 统一 Work 列表、独立面板和 Operation 详情的生命周期表达，分别呈现提交、已接受目标、Core 已确认状态、观察状态与最终结果，覆盖 Create / Start / Stop / Retry / Delete。
- 正确映射 `provisioning`，创建与重载后关联当前身份已知的原生命周期 Operation；启动中允许按既有准入显式 Stop，旧结果不能覆盖新停止目标。
- 统一手动检查与自动观察的收敛路径，持续更新进行中的 Work；Operation 终态后继续完成必要的对象/列表确认，读取失败可只读恢复，不被静默忽略。
- 清理 Desktop 正常读取成功后的永久状态条；等待、错误、未知修改和持久 Operation 分别在所属控件、模块或详情显示，正常导航不产生成功记录流。
- 补充无需整页刷新的浏览器验收和真实 Go Core / CLI / Docker 验收，核对 UI、Operation、容器、Service 与文件准入的一致性。

### Goals

- 用户能在列表及 Work 面板完成 `Create → Ready → Stop → Stopped → Start → Ready`，每一步看到真实进展、可用动作和恢复入口。
- 页面重载、关闭详情、返回列表、查询暂时失败及 Stop 取代 Start 后，原操作仍可查询，且不会自动重复写入。
- 页面保持既有产品语言，反馈简洁、就地呈现，不堆积技术流水。

### Non-goals

- 不重写 Core 生命周期执行器，不新增 Core API、事件协议、全局 Operation 历史或持久化格式；现有 Core 行为作为验收依据。
- 不扩展 ServeUI 的反馈改造，不实现新生命周期动作、Work 重命名、文件锁、AI 部署能力或通用浏览器页面同步。
- 不修复所有 Files/Settings/Run 业务流程；本次覆盖反馈呈现的回归，完整生命周期验收使用 Service 与 WebDAV 验证停止及恢复边界。
- 不重新设计界面导航、主题或大范围组件体系。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：补足 Work 生命周期状态投影、原操作恢复、统一只读收敛与低干扰反馈的可测试行为；落实 DWUI-003、010、011、012 和 DUL-003、007、008。

## Impact

- Desktop 前端：`apps/desktop-webui/src/models.ts`、`adapter.ts`、`app.ts`、`action-state.ts` 与必要的局部样式。
- 测试及交付：Desktop 状态/浏览器测试、`test/real-core.mjs`、`docs/webui-integration.md`；构建后更新 `internal/desktopassets/static/` 的 Go embed 资源。
- 接口：复用 CLI 已有 `works`、`works/:id`、生命周期 POST、`operations/:id` 和 `known-operations`；不增加浏览器持有的凭证或 CLI 运行时依赖。
- 并发与安全：保留同对象提交锁、未知结果保护、Core/账号隔离及 CSRF；旧请求按对象、控制版本和本地观察代次丢弃。仅重试 GET，不自动重放生命周期修改。
- 持久化与兼容：复用已知操作的最小 ID 记录；不改变 Work 包、共享数据、Service enabled 或 Pi Agentd 协议。
- 真实验收使用独立端口、配置目录和 Core installation 标签，仅清理本次测试资源，保留用户与其他开发环境的服务。Core 若出现实际执行与规范冲突，记录证据并停止对应验收，不扩大本变更为后端重写。
