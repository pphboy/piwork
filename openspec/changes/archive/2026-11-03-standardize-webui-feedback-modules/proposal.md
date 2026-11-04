# Proposal

## Why

Desktop 与 Serve 的等待、结果和恢复反馈存在重复插入 Alert、布局受状态变化推动及图标/导航作用域不一致；代码又把状态、渲染、事件和 API 访问集中在入口中，后续局部修改被迫读取大量无关上下文。用户要求依据最新 V13 整理正式 OpenSpec，并明确防腐不只针对前端，而要覆盖整个项目的代码、配置、文档和界面，避免重复来源、过期说明、接口失配及跨层漂移。

## What Changes

- 以 OpenSpec 为需求和验收来源，冻结最新 V13 为视觉参考附件。范围覆盖现有 Desktop + Serve 的全部可观察状态、独立表单及登录/会话恢复；35 个来源族和 277 个原型场景条目仅是审查索引，不等于完整真实后端测试，也不授权遗漏未画出的分支。
- 取消额外插入、推动正文的普通状态 Alert 框，统一单一浮动通知宿主；原按钮/对象等待槽、首读/空/失败/旧数据区别、字段错误、危险/未保存确认、真实进度与可达的恢复方向保持。通知不是全局任务历史或操作中心，关闭不取消任务、不解除未知写入锁。
- 导出 Details 改为同一非模态、仅进度与必要控制的面板；不在其中堆叠 ID/旧快照/诊断卡。业务内部仍保留原 Work/Operation/snapshot/transfer 关联；必要的安全诊断和按原 ID 找回留在所属 Work 的独立恢复上下文。停止确认、私有内容提醒、单次交付、Pause/Check/Resume 与身份撤销不削弱。
- 保留原 PW Logo，不重绘或替换；Open 使用进入工作区箭头而非外链/播放，Refresh 使用统一 18px 单圆箭头；头部保持 V12 紧凑层级，Work 只保留一个紧凑身份栏，不增加第二层品牌顶栏。
- Desktop 的 Administration（管理）只放全局账号菜单；Admin Header 直接保留 Workbench 返回入口。Work 列表行及行菜单不放 Admin/Requests；Requests 只在已打开 Work 内按对象范围进入。菜单接口显式区分 row 与 work-header，保留语言及其他适用动作。
- 建立项目级维护契约：每次后续授权变更按代码、配置、协议/生成、文档和界面分类影响，明确权威来源、责任模块、直接消费者与必要检查；同步默认值/兼容、生成物、双语说明与 UI，清理触达范围已确认失效的配置/入口/文档，不建立平行规则或无界全仓审计。
- 以唯一状态所有者、窄接口、单向依赖、无循环、共享行为单一来源、直接 import 测试、最小模块导航和上下文范围检查防止代码腐烂。不把切小文件或任意行数限制当作完成；按功能行为保持地渐进抽取，保留已有 ExportFlows 等有效边界。
- 将项目编码 Skill、AGENTS 短触发入口及可执行边界/回归检查列为后续实现任务；本轮只在 change 内保存 Skill 候选，不安装、不修改生产源码或开发入口。

## Capabilities

### New Capabilities

- `project-maintainability`：项目级代码、配置、协议/生成物、文档和界面的一致性、责任边界、每次变更触发的影响分类与可执行检查；复用现有文档治理/平台/交付契约。
- `webui-module-boundaries`：状态所有权、功能接口与依赖方向、菜单上下文、单一来源、可直接测试、渐进迁移及维护上下文验收。

### Modified Capabilities

- `ui-language`：共享通知/状态规则、原 PW Logo、18px Refresh 与 Open 图标、紧凑 Header 和两端覆盖要求。
- `desktop-ui-language`：Work 导出进度与诊断分层、任务反馈、全局/Work/行级入口的明确边界。
- `desktop-webui`：导出连续性与独立恢复、反馈收敛、未知锁、固定恢复入口及全部来源状态验收。
- `serve-ui`：表单/对象状态与统一通知的职责、保存与关联刷新分离、登录/会话及各管理功能的覆盖。

## Impact

后续实施预计触及 `apps/ui-shared/`、`apps/desktop-webui/`、`apps/console-webui/` 的本次责任模块、测试和资源构建/嵌入入口，以及获批的项目 Skill/AGENTS 入口；不新增通用任务队列，不改变 Core API、权限、数据协议或产品运行依赖。Go/TS 维护原则适用于后续相关代码，本批不是全仓库重构。项目级治理还关联 `cmd/`、`internal/`、保留的 TS 应用/共享包、`proto/`、`scripts/`、配置/生成链和双语 README/部署/示例的既有检查入口；只按实际影响维护，不预设修改全部这些路径或变更默认值/API。现有 RDOC-001 至 RDOC-008 与其有效 Linux delta 继续是文档归属/执行入口依据。

基线为 `piwork@7c2325552a6db6e6777120c24135c16e458adcd5`。活跃 `support-bilingual-webui`、`simplify-linux-delivery` 已有完成任务但未归档；本 change 保留所选语言与现行 Linux/统一 HTTP 入口，不用旧主 Spec 的英文/Windows/独立 Console 文字倒退覆盖。重叠 requirement 在本 change 合并表达，其他 change 不修改或自动归档。

本次授权仅为正式规划和所属原型附件。任务清单不是执行授权；完成规划后等待新的 apply 请求，不自动实施、提交、push、同步主 Spec、归档、发布或部署。
