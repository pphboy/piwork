# Spec Delta

## MODIFIED Requirements

### Requirement: 在默认认知中嵌入完整工作站开发规则

**Identifier:** BRN-002

启用的脑包 SHALL 在每次新建或恢复的执行上下文中提供四项稳定通用认知：Understand / Specify、Act、Verify、Remember。创建或修改 Service 时 SHALL 自动采用现有 deploy-work-service Skill 的必要 Spec、开发、Agent-operable、部署及实际验证规则；普通 Service 操作 SHALL 优先直接使用已有 Query / Action 并验证，不因操作目标启动开发或编写 Spec。固定 Core 只提供原则与路由边界，Service 细节由 Skill 和现有 Reference 提供，动态认知由独立 Work Memory 提供，不要求用户逐项选择或审批。不得把四项原则实现为四个 Agent、第二套运行时或新工作流引擎。

实际执行 SHALL 继续由原 Agent Runtime、BrainFlow、BrainLoop 和 RunManager 负责，Service 保持权威业务状态。默认认知不得复制已有请求、Job、Evidence 或服务生命周期状态机制。必要工具缺失、Service 外部观察范围和未知结果 SHALL 按原事实说明。

Pi 开发维护的 Service SHALL 在首次交付时具备 work-agent-feedback 契约和反馈入口。外部 Service SHALL 以状态、端点、日志和生命周期作为观察来源，不强制插入业务事件。分类 SHALL 依据代码开发维护责任，不能将「由 Pi 部署第三方镜像」自动归为 Pi 实现的业务。契约 SHALL 不限制 Service 的语言、框架或数据库。

#### Scenario: 从模板开发工作站
- **WHEN** 用户基于带脑包的 Work 请求开发待办或个人复盘服务
- **THEN** Pi 的执行上下文已有上述认知，首次交付同时包含可用业务、状态/Action/Event 和反馈路径

#### Scenario: 部署第三方应用
- **WHEN** Pi 部署未由自己开发维护的第三方应用
- **THEN** Pi 查询并报告实际外部状态，不宣称看到了用户业务操作或强制改造第三方代码

#### Scenario: 使用另一技术栈
- **WHEN** 用户要求用其他语言或框架实现同一工作站能力
- **THEN** Pi 保留相同状态、Action、Event、验证和反馈行为，不因参考示例的技术栈拒绝开发

#### Scenario: 操作已有 Service
- **WHEN** 用户要求将已有 kanban 卡片移到 Doing
- **THEN** Pi 使用声明的 Action 和实际验证 Query，操作与用户 UI 作用于同一业务状态，不改代码、不创建开发 Spec 或 Package 候选

#### Scenario: Skill 与固定原则各自加载
- **WHEN** 默认脑包执行 Service 开发任务
- **THEN** 通用认知说明理解、行动、验证和记忆原则，实际 SDK 能读取 deploy-work-service Skill，开发细节不要求从 brain.md 的第二份实现规则重建

### Requirement: 读取可变 Work 经验并确认实际采用

**Identifier:** BRN-003

系统 SHALL 使用 work-memory 契约管理独立 Work Memory，保留现有 brain_experience 工具名及 list / stage / commit / status 兼容行为。偏好、已验证经验和可信知识 SHALL 与 immutable 包、AGENTS context、Service Spec、业务数据库及执行记录分开，遵循 WMEM-001 至 WMEM-006 的来源、验证、容量、检索、版本固定、修正/失效和迁移规则。

后续 Run SHALL 在模型调用前提供按任务筛选的有效认知，并记录固定版本与实际提供条目；已接受 Run 保持其原快照。正常学习不要求 Package Prepare / Apply，不重建 Runtime，不以全库无限注入替代 Recall。读取失败或格式损坏 SHALL 明确阻止依赖该认知的执行，不用空经验伪造正常采用。Memory 不能授权扩大工具权限、修改平台凭据或改写 Founder Baseline。

#### Scenario: 新 Session 采用已验证的经验
- **WHEN** Pi 验证复盘改进并保存相应经验，用户在新 Session 再次生成复盘
- **THEN** 新执行读取并记录该经验版本及实际相关条目，结果和执行依据可以证明规则被采用

#### Scenario: 验证失败的学习候选
- **WHEN** 一次服务改进未通过验证
- **THEN** 原有效经验保留，失败候选及其原因可查但不进入后续默认认知

#### Scenario: 执行中提交了新经验
- **WHEN** 当前 Run 已开始后另一个已确认来源提交新经验
- **THEN** 当前 Run 保持开始版本和原内容，下一次 Run 读取新版本

#### Scenario: 经验容量达到限制
- **WHEN** 新有效规则超过条数或单条大小限制
- **THEN** 提交明确失败并给出合并或替换方向，原有效版本保持可读，不宣称新规则已经采用

#### Scenario: 修正或失效动态规则
- **WHEN** 一条认知经验证被修正或失效
- **THEN** 后续默认采用更新，旧 Run 可查原版本，脑包 bytes、权限和配置保持不变

### Requirement: 服务与大脑更新均经过生效验证

**Identifier:** BRN-005

Service 修改 SHALL 保留改前代码/配置依据，经测试、部署及业务验证后才报告完成；恢复 SHALL 区分代码/配置与已提交业务数据，不承诺后者被自动回滚。下一次使用 SHALL 能观察更新效果并读取改进证据。

用户明确要求或正式软件维护需要更新脑包 Core/Extension/Skill/Tool 的任务 SHALL 能由 Pi 准备当前 Work 的同名候选包，通过既有包准备流程更新 desired，并显示等待显式 Apply。Apply 成功后 SHALL 在新 active context 的兼容 Session 中确认资源实际加载和相关能力可用，再回写更新完成；失败、被取代、候选被移除和验证超时 SHALL 明确收尾，不得自动 Apply、改绑旧 Session 或重新写回已被用户替换的 desired。包准备、Apply 和采用验证 SHALL 全部在本版可完成。

普通经验新增、认知修正/失效或可复用规则积累 SHALL 只通过 Memory 发生，不将修改脑包源码、Prepare 或 Apply 定义为学习步骤。Service 的设计修改 SHALL 更新该 Service 的 Spec。Brain Core 保持稳定原则；其软件更新仍走本要求的正式路径，不因一次任务经验自行触发。

原候选观测结果推进目标之前 SHALL 检查原期限与最新状态。只有仍有效的目标才能首次进入七天 Apply 等待；期限到达后成功回执或实际 active/loaded 事实 SHALL NOT 延长期限或复活目标。已超期目标 SHALL 为 needs_attention/REQUEST_EXPIRED，保留候选、desired 和原历史，不重新 prepare 或接受验证 Run。

每个新的 live 脑包候选 SHALL 在提交前固定一个与原更新目标相关的能力验收项，包含目标脑包工具、输入和必要 checks；同键改变验收项 SHALL 冲突。实际采用 SHALL 同时满足候选内容实际 active/loaded，以及当前目标执行中真实 SDK 调用匹配验收项、必要 checks 全部通过。模型文字、无关工具成功、通用 status、单独 Skill 读取或其他目标/旧 Run 的证据 SHALL NOT 作为该目标的行为通过证明。检查输出缺失、错误或不通过 SHALL 明确需处理；实际已加载包继续按真实状态展示，不把行为失败冒充加载回退。

本版候选 SHALL 必需具备合法验收项；缺失或非法候选数据 SHALL 明确拒绝，不补造验收项或通过依据。已完成历史和导入 historical 记录 SHALL 保留原事实且不复活。验收项由脑包根据具体目标设计，不新增通用工作流、平台脚本执行入口或 Service 技术栈限制。

#### Scenario: 服务改进真正投入使用
- **WHEN** Pi 修复复盘遗漏并成功部署
- **THEN** 验证实际业务输出后显示完成，后续复盘采用新逻辑，原数据保留

#### Scenario: 脑包更新等待 Apply
- **WHEN** Pi 准备的新脑包成功进入 desired
- **THEN** Settings 与原请求显示 Not applied/等待 Apply，原 Run 释放执行位置，当前包仍为旧版

#### Scenario: Apply 后确认新工具
- **WHEN** 用户显式 Apply 候选并通过真实加载
- **THEN** 后续兼容 Session 的实际 SDK 调用满足提交时固定的工具、输入及必要 checks，原请求取得关联本次执行的可查询行为证明后才完成

#### Scenario: 无关工具成功不完成原更新
- **WHEN** 新包已加载，但 Pi 只成功调用无关工具、通用 status 或读取 Skill
- **THEN** 仅有相应调用或加载事实，原目标不能据此 completed，缺少目标证明时明确需处理

#### Scenario: 新能力加载但行为不符合
- **WHEN** 实际候选工具和输入匹配验收项，但必要 checks 缺失或不通过
- **THEN** 原目标为 needs_attention，保留失败依据且不提交已验证经验；包的实际 active/loaded 状态如实保留

#### Scenario: 更新失败或被用户替代
- **WHEN** 候选加载失败，或等待期间用户替换/移除该候选
- **THEN** 系统保留既有 active 及真实恢复结果，原请求明确失败或需处理，不重新覆盖用户选择

#### Scenario: 原期限之后才取得候选成功回执
- **WHEN** 原准备或恢复查询的成功回执恰到原请求或当前等待期限或之后返回，即使候选已 active/loaded
- **THEN** 原目标明确超期需处理，保留候选及真实 desired/active/loaded，不进入新的七天等待或能力验证；先提交的取消与终态保持

#### Scenario: 学习不变成脑包自更新
- **WHEN** Service 任务形成经验证的新偏好或经验，但用户没有要求软件维护
- **THEN** 只提交 Memory，脑包源码、desired、active 和 Prepare / Apply 记录不变

## ADDED Requirements

### Requirement: 保持 Founder 控制的简洁架构不变量

**Identifier:** BRN-007

项目 SHALL 在 docs/piwork-brain/BASELINE.md 保留 Mark 本次授权的初始架构决策：最少用户干预、最短有效执行路径、Spec-first Service Construction、Agent-operable Service、Verified Outcomes、Independent Memory、Minimum Sufficient Harness，以及可观测性不得改变 Agent 执行语义。文档 SHALL 标明版本、来源与对应测试，演化用 Git 历史追踪，不新增管理后台或版本控制系统。

Agent SHALL 不因学习、代码简化或失败测试自行改写已批准决策；未来决策修改须 Mark 授权，普通实现选择不增加人工审批步骤。认知里的可复用规则属于 Memory，Service 设计事实属于 Service Spec，固定权限与架构不变量不能由 Memory 改写。文件规则与 Git 历史本身不得被宣称为已强制执行的身份审批隔离。

#### Scenario: 初始 Baseline 与日常学习
- **WHEN** 建立本次初始 Baseline 后，一个 Work 提交新的认知
- **THEN** 初始文档只包含 Mark 本次给定决策，学习不修改文档或脑包，版本及 Git 变更可查

#### Scenario: Agent 提出改变架构边界
- **WHEN** Agent 认为需要改变已批准不变量
- **THEN** 提出建议并等待 Mark 的决策，不为使实现或测试通过直接改写 Baseline
