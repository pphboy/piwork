# Proposal

## Why

Desktop 的菜单和选择器偏宽、偏松，Session、Focus、请求及语言存在重复或跨作用域入口；文件详情的返回方向、双层标题和空态引导也增加了理解成本。本次将已经讨论的调整收敛到当前默认样式和真实业务契约上，避免把独立原型的简化、模拟数据或临时覆盖代码当作产品需求。

## What Changes

- 复用当前共享令牌、字体、Logo、控件及图标来源，在指定容器中采用紧凑密度；保留 Work Header 52px、Service/Chat Toolbar 39px，Files 工具栏使用本变更明确的 44px 局部规格。统一刷新图形，优化 Work 身份图标和列表中的打开入口。
- Work 列表增加 List/Grid 切换，两种布局使用同一真实列表、搜索、状态和操作；确认没有 Work 时显示简单的用途说明以及并排的创建、导入动作，不增加新的首次使用流程。
- Work 行与详情菜单保持一致，按设置、Work 信息、导出、适用生命周期操作及删除组织；移除 Operation history、Find a previous export 和语言菜单项。原操作记录、未决任务及原快照恢复能力仍由所属信息/导出上下文承接，不删除业务记录或恢复保护。
- 全局账户菜单使用紧凑命令行，托管管理员保留管理、日志导出并增加指向现有 /admin/setup 的 Quick Setup 快捷入口。语言从账户菜单侧向展开为二级单选 Pop；Work 菜单和 Work Settings 不再重复提供语言入口。
- Service 选择器弱化触发器并使用紧凑、列对齐的列表，将原管理能力纳入该 Pop 的管理子视图；右侧既有布局、Focus、外部打开与更多图标保持原有职责。移除更多菜单中的重复打开和管理入口，外部打开集中到一个工具栏动作；既有直达访问和独立外壳的兼容行为继续保留。
- Chat 顶部移除 Agent 标题文字，Session 选择只保留右上角入口，新建会话留在选择器内；Focus/恢复只通过头部当前上下文的一个控件呈现。Agent 请求收进 Chat 的辅助菜单，使用同一个 Work 请求检查器及 Service 来源过滤，不增加第二个对话上下文。
- Work 路由与共用 Header 的局部读取以固定槽骨架表达，替代可见三点；只改变等待呈现，不隐藏真实对象状态、错误或恢复动作。
- Settings 重新组织分类导航、能力行和操作层级，继续完整提供 Skills、Pi Packages、AGENTS.md、Advanced 及真实 Save/Apply 状态；Files 采用左侧返回、文件身份/保存状态合并的单行工具栏，并统一刷新图标。Core 连接 Pop 改为紧凑属性与状态行。
- 将现有 v11 原型冻结为本变更的设计附件，保留原版/调整版比较及合成接口声明；A/B/C 只是研究方案，规划默认采用反复评审的紧凑 A 方案，不把原型切换工具、模拟业务和替代 CSS 系统交付到产品。

## Capabilities

### New Capabilities

无。复用现有能力边界。

### Modified Capabilities

- `desktop-ui-language`：调整 Work/Service/Chat 入口归属、Service 管理容器与外部打开入口，补充列表布局、简单空态、紧凑容器及 Files/Settings 呈现规则。
- `desktop-webui`：修改请求检查器、Service 选择与管理、历史操作恢复的入口契约，并约束真实页面实现及交互连续性。
- `ui-language`：更新语言入口与二级 Pop、Work 打开/刷新图形、Files 密度、Quick Setup 快捷入口和 Header 骨架的明确例外，保持共享样式与双语规则。

## Impact

- 主要涉及 apps/desktop-webui/src/{app,work-chrome,overlay-role,workspace-layout,locale}.ts、相关目录/文件/配置/导出呈现模块、public/style.css、双语 catalog，以及 apps/ui-shared/{tokens.css,controls.css,feedback-primitives.js,i18n.js} 的相应角色接口。
- 共享模块被 Console 消费时同步其复制资源和回归检查；本变更不重设计 Console 业务页面或 Quick Setup 流程。按现有生成链更新 Desktop/Console 的 Go 内嵌资源，并重建宿主进行验收。
- 不新增框架、图标库、业务 API、DTO/proto、持久化格式或宿主配置；不改变 Core 权限、Service URL/Origin/Cookie 边界、Work 生命周期、Save/Apply、文件版本检查、Run/Request 或自动 Service 选择/刷新的业务语义。
- 需要更新受影响的组件/契约和 Playwright 测试，核对真实原入口、状态、键盘、窄屏、iframe/Session/草稿连续性及生成物。原型的合成接口通过不等于真实 Core、下载落盘或模型执行通过。
