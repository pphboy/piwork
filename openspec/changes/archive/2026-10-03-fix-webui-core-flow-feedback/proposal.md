# Proposal

## Why

Desktop 的正常操作在请求返回前主要只禁用按钮，用户无法判断点击是否生效；部分 acceptance 被关联读取阻塞，下载进度没有显示。Serve 的手动检查、本地预检及修改成功后的刷新也存在反馈断层，需要将正常路径的即时反馈、阶段和最终结果纳入逐入口验收。

## What Changes

- 为 Desktop 的连接、创建/生命周期、Work/模块读取、Session/Run、Service 控制/日志、Files、Settings/Pi Package、Inspect/Import/Export/Download 和已知操作查询建立可见的动作状态，覆盖鼠标、键盘和文件选择入口。
- 按动作所属对象阻止重复或冲突提交，移除 Desktop 的整页按钮锁；普通关闭、导航、复制和无关对象的合法动作保持可用。
- 取得 acceptance 后立即显示原 Operation/Run 身份和已接受事实；同步修改确认后立即显示结果，后续读取单独呈现刷新中/失败，不将刷新失败写成修改失败。
- 展示真实上传字节、逐文件结果及本机下载准备/验证状态；复用已有本地 transfer ID 和查询接口，无总量或远端进度时只显示已知阶段。
- 补齐 Service 入口失败、预览未确认及独立窗口被拦截的反馈和回退，保持 iframe 与应用 origin 隔离。
- 补齐 Serve 手动状态/Operation/配置读回、注销、本地文件预检和账号/Skill/Package 修改后刷新的反馈；保留已有登录、保存和上传反馈。
- 逐入口增加延迟响应断言，覆盖点击后响应前、acceptance、慢刷新、终态、失败/未知及晚响应，并更新构建资源和验收记录。

目标是使用户在现有主流程中知道正在操作哪个对象、已确认到哪一步、下一步能做什么。普通导航用目标页面到达作为完成反馈，复制继续使用简短提示；不要求每个动作增加 toast。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：增加逐入口即时反馈、对象级重复/冲突控制、确认与刷新分离及传输观察契约，落实既有 DUL-003/007 与 DWUI-001—010。
- `serve-ui`：增加管理员手动动作和本地预检的可见等待状态，以及已确认修改与关联刷新分离的规则，沿用已有导航与管理语义。
- `browser-service-access`：细化 BSA-005 的入口准备、未确认预览、打开失败和弹窗拦截场景。

## Impact

- 影响两套浏览器应用的 app/adapter/models、轻量动作状态辅助模块及局部 CSS；浏览器测试、必要 Go CLI 契约测试、`internal/*assets/static` 和 `docs/webui-integration.md` 随实现更新。
- 下载沿用 `X-Piwork-Transfer-Id`、`downloads/:id` 与原 snapshot；本地 Pi Package 上传沿用现有 multipart；文件仍使用既有 Core WebDAV 条件和字节语义。无需新增 Core API、CLI 命令或持久存储。
- 前端状态仅保存当前身份的动作和对象上下文，非敏感草稿保持；晚响应不得更新其他 Core/账号/Work。未知 mutation 不自动重发，不虚构阶段、百分比或终态。
- 保持 Go Core/CLI/Console、TS Pi Agentd、既有 `.work` 格式及生命周期、CSRF、凭据隔离、Service 原安全策略和独立 origin。
- 不重新设计布局、导航或配色，不引入大型 UI 框架、通用任务队列、主题系统、全局 Operation 历史或服务端任务取消能力；不增加 Node 运行依赖。
- 本 proposal 只提供实施规划；先前两项完成变更的任务记录不改写。本变更实施并验收后才可声明反馈问题已修复。
