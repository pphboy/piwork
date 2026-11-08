# Spec Delta

## ADDED Requirements

### Requirement: brain 内置可选 FastAPI 开发能力并保留默认环境

**Identifier:** BRN-016

新版 piwork-brain SHALL 同时提供 NiceGUI 默认能力与 FastAPI + htmx 可选能力。用户通过自然语言指定 FastAPI/htmx 开发时，Pi SHALL 能从当前已采用的冻结包取得匹配模板、环境身份及指导，沿原 Service 流程开发和交付，无需用户安装独立 Skill、选择新产品模式或逐步审批开发过程。未指定技术栈的新 Web Service SHALL 继续遵守 BRN-008 的 NiceGUI 默认，不能把应用规模或一次页面故障作为自动重写既有应用的授权。

该增量 SHALL 经现有脑包软件更新机制交付，遵守 BRN-001、BRN-005 的 catalog 更新、管理员定制保护和已有 Work 显式采用边界，不将“内置能力增补”解释为热更新旧 active context。镜像尚未发布、身份不兼容或能力不可用时 SHALL 如实表达，不回退到另一技术栈并声称原请求已经完成。

#### Scenario: 新 Work 使用用户指定的内置能力
- **WHEN** 新 Work 已加载包含该能力的脑包，用户要求使用 FastAPI + htmx 创建应用
- **THEN** Pi 可读取并使用相应模板、匹配环境和指导，完成原部署路径，不追加技术栈选择界面或新审批阶段

#### Scenario: 默认与已有应用继续按原选择工作
- **WHEN** 用户未指定技术栈创建新 Web 应用，或继续维护已有 NiceGUI/其他栈应用
- **THEN** 前者使用 NiceGUI 默认，后者按实际源码和用户请求维护，不因新能力存在自动迁移

#### Scenario: 旧 Work 尚未采用新版脑包
- **WHEN** Core 已提供新版内置包，但旧 Work 仍使用捕获的旧 active context
- **THEN** 旧 Work 保持原能力和源码，只有现有包更新及显式 Apply 后才在新执行上下文采用新资源

### Requirement: FastAPI starter 提供可直接修改的工程坐标和同业务示例

**Identifier:** BRN-017

脑包 SHALL 提供可安全初始化的 FastAPI starter，包含与现有 NiceGUI 示例相同的待办、个人复盘、异步导出及反馈业务闭环。应用 Spec SHALL 提供与实际源码一致的 Intent、Objects、State、Business Flow、Agent-operable Capabilities、Implementation Map 和 Acceptance Criteria，使 Pi 能定位路由、业务、直接 SQL、完整页面/片段、静态资源和测试，按实际修改范围维护坐标。

工程指导 SHALL 使用已确认的轻量结构，不为“工程化”新增 ORM、迁移体系、独立前端构建、空抽象层或用户审批。FastAPI/htmx 专项内容 SHALL 作为现有部署 Skill 与 application-awareness 的按需资料提供，涵盖前缀、表单错误、状态同步、输入保护、Bootstrap CSS 行为边界和实际入口验证；普通业务操作及无关技术栈不为此额外加载专项正文。

初始化 SHALL 沿原无覆盖入口，先提供必要 Spec，再提供独立可编辑的应用副本。应用运行 SHALL 不依赖另一个 Work 或冻结脑包目录中的可变业务文件。UI 与 Agent 的业务逻辑 SHALL 保持同一权威实现，框架更换不改变 Query/Action/Job/Event 的业务语义。

#### Scenario: 从模板安全创建可维护的应用
- **WHEN** Pi 在尚不存在的目标初始化 FastAPI starter
- **THEN** 取得可写且完整的 Spec、源码与注册信息，Implementation Map 对应真实模块，应用可沿现有环境独立检查和运行

#### Scenario: 局部页面或业务修改
- **WHEN** 用户仅要求修改布局样式，或修改一项业务规则
- **THEN** Pi 依据实际坐标更新受影响源码和验收，布局修改不复制业务逻辑，业务修改同时作用于 UI 和 Agent，不追加无关工程设施

#### Scenario: 专项指导按当前任务读取
- **WHEN** Pi 开发或排查 FastAPI/htmx 页面，或仅执行现有业务 Query/Action
- **THEN** 前者可从当前冻结包取得专项指导，后者直接操作原业务能力，不进入模板初始化或开发流程
