# Proposal

## Why

统一程序已完成一键启动和运行依赖自动准备，但首设、Quick setup 与日常管理仍混用首次部署语言，多种 Pending 与整页刷新打断输入。本变更复用现有实现，缩短“启动 → 安全初始化 → Key → 自动准备 → 工作台”的路径，并统一 Server / Desktop 的等待反馈。

## What Changes

**2026-10-20 所有者已授权 apply，并进一步限定本轮只改 UI 和前端交互：D1 保留局部单次自动进入；D2 涉及 Go 启动，移出本轮；D3 保留手动正常登录。已授权实现、验证及推送 PR，最终代码审查后发布草稿 PR；不合并或部署。**

| 实施模块 | 修改内容 | 范围 |
| --- | --- | --- |
| M01 首设界面 | 统一现有授权、创建管理员、正常登录的组件和反馈 | 仅页面；创建后清空密码并手动登录，保留证明、CSRF、原子创建与既有认证；Go启动入口不变 |
| M02 QuickStart | 新空配置默认 deepseek-flash / anthropic-messages / https://api.deepseek.com/anthropic，只展开 Key；高级字段折叠、正确 dirty 基线；准备摘要和六项明细；本次主动首设保存后 Ready 单次进入 | 复用模型保存、Runtime 绑定与代次保护；不覆盖已有模型、不改 adapter、六项完成条件或准备调度；显式 Test 保留 |
| M03 管理体验 | Overview 单一主动作、Runtime 回归维护；同页刷新保留正文、草稿、焦点、展开、滚动与当前对象 | 复用既有路由、配置与页级读取；去重入口，统一聚合刷新，不给每张卡独立刷新动效；不删功能或重写业务状态 |
| M04 共享 Pending | Server / Desktop 全部真实 Pending 采用局部三点依次淡入淡出、1.2s、固定占位；终态停止、慢等待可解释 | 完整保留31位置映射及 Chat Activity；共用样式/薄渲染接入现有状态，无全局遮罩、无 Modal 动画 |

### 已确定的取舍

- **D1：保留有条件自动进入。** 仅当前管理员在未配置安装直接 Save and continue，保存与全部准备已确认且本次页面/身份/草稿未变化时进入一次。已配置管理、背景 Ready、刷新恢复、保存后前往另一目的地均不自动跳；手动出口保留。只在 Quick setup 局部复用现有代次，显式修改 ONBOARD-003 的原手动完成规则，不新增导航框架。
- **D2：移出本轮。** 原生浏览器打开目标、HTTP监听及启动日志涉及Go运行层，保持现状；只优化浏览器已有的授权/首设界面。
- **D3：采用手动正常登录。** 创建成功后沿原流程登录；自动登录延期，不在本 change 增加凭据保留、认证串联或专属测试。
- 既有安全、unknown 恢复、对象锁、重复提交和晚响应保护继续有效，以主规格和现有测试为依据，不重新实现。31位置是覆盖索引，不是31套完整测试矩阵。

## Capabilities

### New Capabilities

无新增能力目录。

### Modified Capabilities

- `web-onboarding`：Key-only 默认、准备摘要及 D1 有条件完成；正常手动登录与 ONBOARD-005 保持主规格。
- `ui-language`：跨端局部三点、固定占位、终态/慢等待与无动画 Modal。
- `serve-ui`：全管理动作等待归属及读取连续性，引用原身份/锁/恢复契约。
- `serve-ui-configuration`：Overview 主动作与 Runtime 维护呈现，保留配置能力。
- `desktop-webui`：全部异步入口采用三点、Core 检查可见；对象并行与业务结果语义不变。

## Impact

- 基线：`efce08c228c12f10d18a968b69c3398bb0e783e1`（main，2026-10-20）。与现状图提交 `4cb118450a89383825d8e136a131eaf7cbc5c543` 之间仅文档/生成脚本变化，UI/Core 源码相同。
- 主要涉及 Console 的 onboarding/quick-setup/model-form/model-management/app、Desktop 的 app/adapter、共享 controls/样式和既有资源嵌入；不编辑 Go 启动、后端认证或运行逻辑。已有 ActionState 直接复用，只有实际必要时才补可见状态。
- 不改变 Core、Go启动/后端认证/运行逻辑、API/持久格式、准备调度、权限、已有 Work 或传输语义。不新增启动器、提前监听壳、持续离线探测、组件框架或测试环境建设。
- [设计](design.md)、[任务](tasks.md)、[31位置映射](pending-map.md) 使用同一四模块范围。动画和共同表现测一次，接入点做覆盖检查，独立状态分支补针对性测试；真实 Core 集成具备条件才运行，未测如实说明。
