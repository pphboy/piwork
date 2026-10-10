# piwork-brain 规范

## Purpose
定义每个 Work 默认拥有的 Pi 大脑包，使 Agent 在开发和维护工作站时持续具备状态、Action、Event、反馈、验证和证据的认知，并让已经验证的服务改进与 Work 经验在后续执行和完整环境分享中得到真实采用。

## Requirements

### Requirement: 安装并实际加载 Work 自有的大脑包

**Identifier:** BRN-001

系统 SHALL 将 `piwork-brain` 作为本地 Pi extension package 管理，Work 内安装源及可编辑副本 SHALL 位于 `.pi/packages/piwork-brain/`，包内 SHALL 包含 extension、默认认知、Skills、Tools 和支持文件；不得将其交付为用户需通过 npm 安装的 Node module。实际执行 SHALL 使用当前 active context 已捕获且验证的包资源，编辑工作区副本不得直接热更新正在运行的包。

全新安装完成默认能力准备后，省略 package 选择的新 Work SHALL 独立拥有并启用脑包，ready 前 SHALL 验证真实资源及工具加载。包目录存在、catalog 安装成功或同名独立 Skill 加载均不得替代该验证。显式 packages=[] SHALL 保持空集合；独立 skills=[] 不得移除已选择脑包提供的 Skills。既有 Work SHALL 通过显式包安装/选择及 Apply 采用脑包，不能静默改写原 active、desired 或镜像。默认选择 SHALL 有一次性完成记录，保留管理员对默认集合和包内容的后续修改。Core 启动 SHALL 更新仍为原内置来源且启用的旧 piwork-brain package，使新建 Work 可捕获随当前 Core 提供的新包；一次性标记不得阻止该内置包更新。更新 SHALL 沿用现有准备与发布校验，保留默认集合，不覆盖管理员替换、禁用或移除的包，不修改既有 Work。重复启动不得重复发布相同内置版本，失败 SHALL 保留旧包。

#### Scenario: 默认 Work 获得可执行的大脑
- **WHEN** 默认能力准备已完成，用户省略 package 选择创建 Work
- **THEN** Work 拥有本地脑包副本，运行状态确认其 extension、认知、Skills 和允许的 Tools 实际加载

#### Scenario: 尊重显式空选择
- **WHEN** 用户分别指定 packages=[] 或仅指定 skills=[]
- **THEN** 前者不安装默认脑包，后者仍可加载所选择脑包内 Skills，均不通过隐式发现补回资源

#### Scenario: 工作区编辑尚未应用
- **WHEN** Pi 修改脑包工作区副本但没有完成 Package Update 和 Apply
- **THEN** 当前及普通重启后的执行继续使用原 active 包，新内容显示未生效

#### Scenario: 默认准备失败或已被定制
- **WHEN** 首次默认脑包准备失败，或管理员在成功种子后清空默认包并重启 Core
- **THEN** 前者不得伪造默认 Work 创建成功并提供准备失败原因，后者保持管理员选择且不重新添加默认脑包

#### Scenario: 更新 Core 的旧内置包
- **WHEN** 已完成 seed 的安装仍保留原内置旧脑包，用户更新并启动 Core
- **THEN** Core 完整准备并发布新版内置 package，新建 Work 捕获新版，原默认集合及既有 Work 副本保持不变

#### Scenario: 重复启动或更新失败
- **WHEN** 相同内置版本再次启动，或新版内置包准备/发布失败
- **THEN** 前者沿用已发布包且不增长 generation，后者保留旧 head 并使用现有准备诊断，不发布部分包

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

### Requirement: 使用可查询的证据回答与完成任务

**Identifier:** BRN-004

Pi 对业务状态、用户操作、任务结果和已生效更新的事实回答 SHALL 引用实际可读的 Service 状态、Event、Action/Job、文件产物或已验证运行结果，记录来源对象与取得时间；陈旧、截断、不可达和未知结果 SHALL 明确表达。事实记录 SHALL 作为判断依据，不能当作绕过 Work 权限、修改模型凭据或扩大执行范围的指令。

选中 Service、推测用户点击、文件写入、Action 接受或包安装成功 SHALL NOT 单独作为业务完成或新能力已加载的证据。回答 SHALL 能在现有 Service/Chat/详情或 Files 中查证相应来源。

#### Scenario: 根据真实操作回答
- **WHEN** 用户询问本周完成了哪些待办
- **THEN** Pi 读取实际状态与相关业务事件，回答包含可查来源，不依据浏览器 DOM 或不存在的记录编造操作

#### Scenario: 来源不可达或结果尚未确定
- **WHEN** Service API 不可达，或导出只返回 Job 接受
- **THEN** Pi 明确显示不可读取或等待结果，不宣称分析或导出已经完成

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

### Requirement: 用单个工作站示例验证全部回路

**Identifier:** BRN-006

本版 SHALL 提供一个可在 Work 内使用、修改和完整分享的「待办 + 个人复盘 + 异步导出」参考示例，复用现有 Work 创建或导入入口。验收 SHALL 覆盖真实 Pi SDK、真实 Service、用户页面路径和业务动作、Service 自动请求、业务改进、异步结果续接、证据回写、下一次执行采用经验、脑包候选 Update/Apply/实际加载、失败恢复及独立导入后处理新请求。参考示例不得成为平台强制技术栈或 Desktop 内置业务应用。

脑包验收 SHALL 使用能够区分旧版与候选行为的真实输出检查，证明该目标的固定验收项通过；仅检查认知 marker 或调用 status 不足以完成行为验收。中断场景 SHALL 分别证明原对象仍运行、已终态和无法证明时的正确收尾；两份导入副本 SHALL 各自处理新反馈并独立完成新候选的相同验收流程，旧请求不执行。

#### Scenario: 完整工作站回路
- **WHEN** 用户开发并使用示例、反馈复盘遗漏，随后再次使用并将环境导入另一 Work
- **THEN** 自动处理与改进验证可查，下一次执行采用更新，接收者保留代码/数据/经验并能独立处理新反馈，旧事件不重放

#### Scenario: 脑包更新路径属于同版验收
- **WHEN** 验收准备一个能区分新旧能力的脑包候选并分别验证成功和加载失败
- **THEN** 成功路径通过目标工具的真实新行为检查，另验证新包已加载但行为检查失败不会完成目标；加载失败路径证明旧 active 与数据保留，不以目录存在、准备 Operation、status 或 marker 替代采用验收

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

### Requirement: 默认采用可复用 Web 基础环境

**Identifier:** BRN-008

全新脑包 SHALL 将 FastAPI + React + TypeScript + Vite 作为未指定技术栈的新 Web Service 的默认环境，并提供匹配 WEBBASE-001 至 WEBBASE-007 的固定基础镜像引用、模板和部署指导。包内 SHALL 保留可查环境身份，使 Agent 无需猜测镜像版本或每次自行安装基础工具链；维护指导 SHALL 指向仓库的长期镜像维护源，不能将脑包内引用或 Work 副本误当构建源。当前认知、Skill/Reference 和模板 SHALL 不再依赖或推荐 NiceGUI；历史验收事实不得被改写为新技术栈已通过的证据。

当前交付 SHALL 移除 NiceGUI 相关认知、实现、依赖、模板、运行入口及使用指导，不保留 NiceGUI 兼容层或默认环境回退。历史归档与真实验收记录 SHALL 保留原事实；必要旧包迁移输入 SHALL 仅作为测试夹具，不进入新版脑包。清理 SHALL NOT 删除既有 Work 已捕获的包、应用或用户数据。

默认环境是可覆盖的开发选择，不改变 BRN-002 的语言/框架自由或第三方应用边界。用户指定其他栈、维护已有应用或采用派生镜像时，Pi SHALL 使用实际目标环境，仍完成同一业务/反馈/验证契约。基础镜像 SHALL 不包含模型凭据、私有 Memory 或脑包执行引擎。

脑包 SHALL 知道 sqlite3 CLI 分别由 Agent 和 base 镜像提供，AI bash 在 Agent 中执行，仅 Service 拥有该命令不能作为 AI 可直接使用的证据。获准的数据开发和诊断可使用实际命令；普通业务操作仍走原 Query/Action/版本契约，不直接改写平台受管状态。旧镜像缺命令或 bash 被 deny 时 SHALL 明确说明，不临时扩大权限或伪称已安装。

既有 Work SHALL 保留其已捕获脑包、业务源码、数据和镜像；采用新默认脑包仍经过现有 Package Update、显式 Apply 和实际采用验证。首次默认选择保持一次性初始化；Core 自身的原内置旧脑包 SHALL 随 Core 启动更新，管理员定制保持原样，不能重新添加默认选择或转换旧应用。新 brain 引用的镜像不可用时 SHALL 报告真实部署失败，不回退到 NiceGUI 或其他可变镜像冒充默认环境已可用。

#### Scenario: 新 Work 无需选择环境
- **WHEN** 使用新默认脑包的 Work 接到未指定技术栈的 Web 开发任务
- **THEN** Pi 从固定基础环境和匹配模板开始，完成 Service 部署及业务验证，不要求用户重复解决 Python/Node/前后端工具链

#### Scenario: 既有 Work 保留原内容
- **WHEN** Core 更新后加载一个仍捕获旧脑包的 Work
- **THEN** 不静默替换包、镜像或业务代码；用户通过既有更新和显式 Apply 才采用新默认指导

#### Scenario: 显式其他栈和派生镜像
- **WHEN** 用户指定另一技术栈或从 Web base 派生的镜像
- **THEN** Pi 沿用该选择及现有业务契约，不强制重写成默认模板

#### Scenario: 默认镜像不可获得
- **WHEN** 固定镜像不可拉取且本地不可用
- **THEN** 原 Service Operation 报告实际镜像失败，Pi 不宣称开发环境或应用已就绪，不替换成 NiceGUI

#### Scenario: 更新 Core 后的新建 Work
- **WHEN** Core 已将原内置 NiceGUI 脑包更新为随当前 Core 提供的脑包，用户创建默认 Work
- **THEN** 新 Work 使用 FastAPI + React + TypeScript + Vite 指导、匹配模板和固定 Web base 引用，不再取得旧 NiceGUI 默认指导

#### Scenario: 新包不再交付 NiceGUI
- **WHEN** 构建并检查当前 Core 内嵌脑包及有效运行依赖、模板和入口
- **THEN** 不包含 NiceGUI 依赖、实现、使用指导或回退；历史记录和隔离的迁移测试输入不作为当前交付内容，既有 Work 数据保持原样

### Requirement: 修改应用后主动完成生效与刷新

**Identifier:** BRN-009

brain/harness 的默认开发认知 SHALL 将“让修改实际生效”视为当前任务的交付责任。修改由 Pi 开发维护的应用代码/配置后，Pi SHALL 通过现有部署 Skill 自动完成必要检查、构建、Service 更新或重启、原 Operation 结果观察、实际运行代码版本和受影响业务验证；不能仅保存文件就让用户手动刷新、重启或完成部署。具体环境/页面更新机制 SHALL 由 Skill/Reference 和模板提供，不新增 Harness 执行引擎或绕过现有工具权限。

支持的默认模板 SHALL 按 WEBBASE-007 自动更新已打开页面；Pi SHALL 区分文件已写、运行版已更新与页面是否具备自动采用路径，不把 Service Ready 或模型文字当作新版业务通过。没有实际可用的部署/刷新能力或验证失败时 SHALL 如实说明并进行原预算内有界修复，不要求用户用手动刷新掩盖未完成的工程工作，也不虚构已观察到所有浏览器。

普通业务数据操作 SHALL 继续使用已有 Query/Action，不为刷新页面修改代码、重启 Service 或触发新 Agent 目标。本规则 SHALL 不修改脑包自身软件更新、Work 配置或包的显式 Apply 边界；第三方页面仍遵循实际可观察范围。

#### Scenario: AI 修改后完整交付
- **WHEN** 用户要求修改默认应用的界面或业务逻辑
- **THEN** Pi 自动完成必要构建/部署与新运行版本验证，默认页面自动采用；回复提供实际结果而非要求用户刷新或重启

#### Scenario: 验证失败不能依赖用户刷新收尾
- **WHEN** 文件已修改但构建、部署或实际业务验证失败
- **THEN** Pi 保留真实失败与代码依据并尝试有界修复，不能报告完成或让用户手动刷新作为通过证据

#### Scenario: 自刷新不触发脑包自动 Apply
- **WHEN** 普通应用更新完成，或 Pi 正式准备了新的脑包候选
- **THEN** 应用按原 Service 流程生效；脑包候选仍等待显式 Apply，不借应用刷新改绑 context 或重放旧 Run
