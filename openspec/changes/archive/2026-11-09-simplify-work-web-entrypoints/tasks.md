# Tasks

## 1. 精简并收紧 New Work

- [x] 1.1 删除创建表单的镜像、完整 JSON、合并摘要/说明及对应无消费者草稿、事件、双语文案，缩小创建 adapter 输入；同步修改现有创建浏览器/adapter 契约用例，验证默认请求没有 baseImage/configuration、Skills/Packages 的 defaults/choose/none 与 AGENTS.md 导入/文本保持原语义，且创建仍只提交一次。
- [x] 1.2 将 New Work 局部样式调整为已选 A（约 480px、自适应高度、单列、紧凑右对齐按钮），新的创建表单与刷新后默认折叠；同步相关 `recovery.test.ts`、`draft-revision.test.ts` 及实际覆盖该表单的浏览器用例，验证收起/展开保留草稿，拒绝/未知/迟到结果与下次新建保护保持；对照本变更原型保存桌面、360px、中英文、展开长内容/字段错误截图到临时 dist，确认主体可滚动且按钮可达。

## 2. 保留 Work 镜像并约束网页 JSON 编辑

- [x] 2.1 在现有 configuration 模块与配置类型中实现不含 agentImage 的可编辑投影、已加载 desired 镜像基线保留及完整 PUT 还原；添加直接 import 模块的单元测试并运行，验证其他字段/空集合/空 AGENTS 跨分类往返、desired 与 active 镜像不同、原镜像与 Core 默认不同，以及新建/导入 Work 的基线均不被替换；不修改 Core/CLI/API/代理协议。
- [x] 2.2 接通 adapter 的读取/保存和 Settings JSON 编辑/导入：不同镜像输入复用现有字段错误并保留草稿，同值可去掉冗余字段，其他配置继续有效保存；同步中英文错误及浏览器用例，验证编辑器无镜像编辑字段、恶意/误导入不同 agentImage 时没有 PUT/Apply、修正后可保存，普通保存仍包含原 desired 基线镜像，失败/未知与 Save/Apply 分离保持。

## 3. 移除手动 Operation 查询入口

- [x] 3.1 删除 Desktop/New Work/创建导入辅助恢复/Work 任务与历史中的手输 Operation ID 控件及无消费者 handler、状态、文案；更新相应恢复与任务浏览器测试，验证各入口及可访问名称不再引导手输 ID，原任务的 Check status/详情/错误恢复和身份匹配仍可用，记录读取失败与未知写入保护保持，独立 Snapshot ID 恢复仍可达；保留 adapter 原查询能力与持久任务协调。
- [x] 3.2 删除 Console Find Operation 导航、独立查找页、提交事件、Overview/窄屏快捷链接及无消费者文案/样式，修正详情和不可用页返回 Packages；同步 `console.spec.mjs`、`management-flow.spec.mjs`、`language.spec.mjs`、`feedback.spec.mjs` 中受影响用例，通过现有 Console Playwright 入口验证裸查找路由为既有未找到呈现、保存的详情 URL 可刷新/重新登录后打开、非终态继续观察、读失败不重新安装且无断链，中英文与窄屏均无手输 ID 入口。

## 4. 同步嵌入资源并验证集成

- [x] 4.1 执行两端 workspace typecheck 和 build，使用现有同步链更新 `internal/desktopassets`、`internal/consoleassets`；运行本批直接涉及的单元/浏览器用例、`node scripts/check-webui-boundaries.mjs`、`node scripts/check-ui-language.mjs` 和对应源码风格检查，确认生成资源与源码一致，未将原型工具或对比布局带入产品。
- [x] 4.2 执行 `make build-go` 及相关 `internal/desktopassets`、`internal/consoleassets`、`internal/webapp` 现有测试；使用独立临时数据目录核对宿主提供的工作台/管理嵌入页面与原 API 路由，确认默认折叠、删除字段、已知任务详情与返回路径均体现新资源；不因界面变更构建/发布生产镜像，不把纯模拟页面结果写成真实 Work 准备或镜像生命周期验收。
- [x] 4.3 在本变更 design 中补充实际修改边界、已执行检查及未测事实，核对 proposal/规格/任务/原型一致；运行 OpenSpec strict validate、`node scripts/check-repository-docs.mjs` 与 `git diff --check`，检查本批遗留查找链接和未使用字段，确认没有额外主规格同步、归档、数据迁移、全局任务中心、提交或发布动作。
