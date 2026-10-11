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

应用创建、功能开发或交互修改 SHALL 由固定认知独立路由至与部署 Skill 平级的 `application-awareness` Skill，读取其中的完整应用认知；正文不依赖先调用部署工具或从 deploy-work-service 转入。持久 Service 的必要 Spec、开发、部署与生效验证仍采用原部署 Skill，同一任务可以使用两者而不增加阶段或人工审批。普通业务操作、仅启停现有 Service 或部署未改造的第三方镜像 SHALL 不因该路由进入产品/界面设计流程。固定认知仅保留简短原则、适用范围与路由，不全文复制五类认知。

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

#### Scenario: 产品与体验认知独立于部署入口
- **WHEN** 用户要求创建应用、改进已有应用功能或调整交互，尚未执行任何部署工具
- **THEN** Pi 可按默认认知直接读取 application-awareness 的完整正文，必要 Service 规则仍分别采用原部署 Skill，无需用户点选或先启动部署

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

全新脑包 SHALL 将 Python + NiceGUI + SQLite 作为未指定技术栈的新 Web Service 的默认环境，提供匹配 WEBBASE-001 至 WEBBASE-009 的基础镜像身份、模板和部署指导。正式默认引用 SHALL 是已发布且验证可用的固定 tag@digest；本地验收 SHALL 显式选择已验证预备镜像，不把候选标记为远端已发布。包内 SHALL 保留可查环境契约，使 Agent 无需猜测镜像版本、重复安装标准 NiceGUI 依赖或准备独立前端构建；维护指导 SHALL 指向仓库长期镜像维护源，不能将脑包引用或 Work 副本误当构建源。

当前默认模板与指导 SHALL 使用 NiceGUI，移除新默认路径对独立 FastAPI + React + TypeScript + Vite 应用工程、node_modules 和前端构建产物的依赖，不将框架切换扩展为删除 NiceGUI 的 FastAPI/JavaScript 传递依赖、Agent 的 Pi SDK 或 Desktop/Console 自身构建。历史归档、已发布固定镜像及真实验收记录 SHALL 保留原事实；既有 Work 已捕获的包、应用与用户数据 SHALL 不被清理。

默认环境是可覆盖的开发选择，不改变 BRN-002 的语言/框架自由或第三方应用边界。用户指定其他栈、维护已有应用或采用派生镜像时，Pi SHALL 使用实际目标环境，仍完成同一业务/反馈/验证契约。基础镜像 SHALL 不包含模型凭据、私有 Memory 或脑包执行引擎。

脑包 SHALL 指导 Pi 直接复用标准环境，并在需要额外 Python 包时遵循 WEBBASE-008，通过现有 Service 命令和应用依赖声明在 workspace 准备独立可写环境，确认实际安装及应用使用，不要求运行中的 Pi 构建镜像、Docker exec 或修改只读根。脑包 SHALL 知道 AI bash 在 Agent 中执行；Service 拥有 Python/pip/sqlite3 不能作为 AI bash 可直接调用这些工具的证据。sqlite3 CLI 分别由 Agent 和 base 提供；获准数据开发和诊断可使用实际命令，普通业务操作仍走原 Query/Action/版本契约。缺工具或 bash 被 deny 时 SHALL 说明实际限制，不扩大权限。

既有 Work SHALL 保留其已捕获脑包、业务源码、数据和镜像；采用新默认脑包仍经过现有 Package Update、显式 Apply 和实际采用验证。首次默认选择保持一次性初始化；Core 自身原内置旧脑包 SHALL 随 Core 启动更新，管理员定制保持原样，不能重新添加默认选择或转换旧应用。新 brain 引用的镜像不可用、环境契约不匹配或仍为未发布候选时 SHALL 报告真实部署限制，不回退到旧 FastAPI/React 或其他可变镜像冒充 NiceGUI 环境已可用。

#### Scenario: 新 Work 无需选择环境
- **WHEN** 使用新默认脑包的 Work 接到未指定技术栈的 Web 开发任务
- **THEN** Pi 从匹配 NiceGUI base 的模板开始，完成 Service 部署及业务验证，不要求用户重复解决标准依赖或前端构建

#### Scenario: 既有 Work 保留原内容
- **WHEN** Core 更新后加载一个仍捕获旧脑包的 Work
- **THEN** 不静默替换包、镜像或业务代码；用户通过既有更新和显式 Apply 才采用新默认指导

#### Scenario: 显式其他栈和派生镜像
- **WHEN** 用户指定另一技术栈或从 base 派生的镜像
- **THEN** Pi 沿用该选择及现有业务契约，不强制重写成 NiceGUI 模板

#### Scenario: 默认镜像不可获得
- **WHEN** 固定镜像不可拉取且本地不可用，或引用的环境仍是未验证候选
- **THEN** 原 Service Operation 或部署准备报告实际失败，Pi 不宣称环境或应用已就绪，不替换成旧默认镜像

#### Scenario: 更新 Core 后的新建 Work
- **WHEN** Core 已将原内置旧脑包更新为随当前 Core 提供的新版，用户创建默认 Work
- **THEN** 新 Work 实际加载 NiceGUI 指导、匹配模板与环境身份，既有 Work 仍保留原包和业务

#### Scenario: 新包采用 NiceGUI 默认路径
- **WHEN** 构建并检查当前 Core 内嵌脑包、模板和运行入口
- **THEN** 默认应用不依赖独立 React/Vite 工程，NiceGUI 必要依赖及 Agent/Desktop 自身职责完整，历史记录和旧 Work 保持原样

#### Scenario: 新包不再交付 NiceGUI
- **WHEN** 新版脑包候选遗漏 NiceGUI 默认指导或匹配模板，仍只提供原 FastAPI/React 默认路径
- **THEN** 当前交付检查明确失败，不能将该候选报告为已恢复 NiceGUI 默认环境；既有 Work 的包和数据保留

#### Scenario: 应用需要额外 Python 包
- **WHEN** 用户目标需要一个 base 未预装的兼容 Python 包
- **THEN** Pi 通过实际 Service 环境完成明确的依赖准备并验证应用使用和锁定身份，不把 Agent 中不存在的 pip 或容器只读目录当作安装入口

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

### Requirement: 以独立 Skill 提供完整应用认知

**Identifier:** BRN-010

脑包 SHALL 提供独立的 `application-awareness` Skill，与 `deploy-work-service` 平级。其正文 SHALL 完整承载以下五类产品与体验认知及完成标准，不拆为五个顺序执行的 Skill，不将其全部并入部署 Skill 或常驻认知，也不要求这些通用认知经额外 Reference 中转：

- **Product**：理解用户问题和主要任务，优先最短、完整、可用的核心工作流；不主动增加无关功能、复杂配置或过度抽象，以实际使用体验而非仅代码可运行判断完成。
- **UI**：使用常见成熟布局与组件，使重要信息、主要操作和当前状态容易发现；合理组织信息层级、间距、对齐与组件，保持简洁、一致和整洁，避免凌乱拥挤及无必要装饰，不默认追求品牌包装、复杂动画或定制设计系统。
- **UX**：让用户理解状态、可执行操作和结果，交互直接、减少不必要步骤与确认；按实际需要处理加载、空、成功和失败反馈，遵循熟悉习惯。
- **Reactivity**：用户与 Agent 操作共同作用于 Service 的权威业务状态；正常数据变化自动反映在 UI，无需手动刷新；按现有技术栈选择简单可靠同步，不为自更新引入不必要的复杂实时架构。
- **Engineering Judgment**：以上是默认判断依据，按当前任务适用，不是逐项强制流程；优先现有技术栈与成熟组件，UI/UX 服务于功能交付，不为细微视觉差异反复返工，优先处理影响可理解性、可操作性或正确性的问题。

Skill SHALL 表达“功能可用、操作直观、状态正确、界面整洁即可交付，随后按真实反馈迭代”的完成标准。Work SHALL 被理解为应用所在工作空间，不能将每个 Work 强制等同于单一带 UI 的应用；仅修改后台能力的任务不因 UI 原则而新增无关界面。用户明确提出的设计目标仍属于实际任务范围。

启用新版脑包时，实际 SDK SHALL 能发现并读取该 Skill 的名称、描述、正文和所属冻结包位置。自动发现元数据、常驻路由和模型经授权工具读取正文 SHALL 分开表述；文件存在或模型声称读过不能代替实际读取证据。当前上下文已有同一有效包的正文时 SHALL 允许复用，不要求每个工具调用重新读取。

Skill SHALL 同时提供通用样式隔离、真实用户入口验证及基于证据归因的简短指导。NiceGUI 的具体样式/连接/白屏排查资料 SHALL 作为同一 Skill 的按需 Reference：使用该框架创建或修改页面、排查页面异常时读取；其他技术栈及普通业务操作不为此新增读取。五类正文 SHALL 仍完整保留在 Skill 内，专项 Reference 不成为新的 Skill，不全文注入 Brain，也不依赖部署 Skill 转入。

#### Scenario: 完整五类认知在独立正文中可读
- **WHEN** 新版脑包被实际 SDK 加载并按应用开发任务读取 application-awareness
- **THEN** 取得包含五类认知及完成标准的正文，部署 Skill 仍独立可用，正文来自当前 active 冻结包

#### Scenario: 元数据发现不等于正文注入
- **WHEN** 模型尚未调用读取工具，仅取得默认认知与可用 Skill 列表
- **THEN** 上下文包含新 Skill 的可发现入口及路由，未被声称已自动注入该 Skill 全文；后续相关任务通过原工具读取正文

#### Scenario: 小范围后台功能修改
- **WHEN** 用户只要求修改应用的一项后台业务规则
- **THEN** Pi 按相关 Product 与 Engineering Judgment 判断范围，不主动补建无关 UI、品牌或设计系统

#### Scenario: 未启用或尚未采用新版脑包
- **WHEN** Work 显式不选择脑包、禁用该包，或仍运行捕获的旧版
- **THEN** 不从其他目录隐式补入新 Skill，旧 active、源码和普通业务行为保持；采用新版沿既有包更新与显式 Apply 边界

#### Scenario: NiceGUI 任务按需读取专项指导
- **WHEN** Pi 创建或修改 NiceGUI 页面，或排查该页面异常
- **THEN** Pi 可从当前冻结包读取该 Skill 关联的 NiceGUI Reference，获得样式隔离、真实入口验收与证据排查指导，通用五类正文仍在原 Skill

#### Scenario: 非 NiceGUI 任务不加载专项资料
- **WHEN** 用户使用另一技术栈，或仅执行已有业务 Query/Action
- **THEN** 不为应用认知强制加载 NiceGUI 专项 Reference，不新增 Skill 调用阶段或设计流程

### Requirement: 应用认知保持交付主路径简洁

**Identifier:** BRN-011

应用认知 SHALL 融入当前必要的理解、Spec、实现、部署与实际验证，不能自行扩张为独立设计阶段、额外设计文档/Spec 章节、五项强制清单、人工逐项审批、视觉评分、固定截图审核、额外 Agent 或模型 Run。普通任务 SHALL 不因细微装饰或非目标视觉偏好反复返工；仅维护受影响的既有设计条目及验证。没有值得更新的经验时，不新增 Memory 步骤。

影响核心流程、信息理解、操作可达或状态正确性的问题 SHALL 在本次受影响范围内优先解决；不能以“避免阻塞”为由跳过用户要求、已有必要测试、部署生效或真实业务验证。小改动不自动变为全应用重新设计；达到完成标准后 SHALL 允许交付并按真实反馈继续迭代。

受影响页面的内容可见、主要操作可用与状态正确属于原交付的基本可用性验证，SHALL 不被当作额外视觉设计流程。该验证 SHALL 不自动扩展为全部页面巡检或固定截图审核；仅后台变更不附加无关 UI 验收。实际浏览器能力不足的处理遵循 BRN-014，不通过降低证明标准冒充完整交付。

#### Scenario: 小改动直接完成交付
- **WHEN** 用户要求调整一个列表操作，当前核心流程与基本界面均可用
- **THEN** Pi 读取相关认知并局部实现、验证和交付，不生成独立设计报告、不追加五轮确认或为无关装饰延迟交付

#### Scenario: 普通业务操作不进入认知开发流程
- **WHEN** 用户要求查询待办、执行已有业务 Action 或仅启动现有 Service
- **THEN** Pi 使用原能力和必要结果核对，不为应用认知创建 Spec、修改界面、部署新代码或启动额外 Agent 目标

#### Scenario: 基本操作或状态存在错误
- **WHEN** 当前修改使主要操作不可达、失败没有必要反馈或界面显示过期业务状态
- **THEN** Pi 将其作为受影响功能问题处理并验证，不将其归为可忽略的视觉微调，也不靠放宽原验收条件报告完成

#### Scenario: 用户明确要求视觉工作
- **WHEN** 用户的原目标包含具体界面风格或视觉改进
- **THEN** Pi 在该目标范围实施并验证，避免过度设计的默认原则不取消用户明确要求，也不增加无关审批阶段

### Requirement: 业务状态自动同步并保护当前操作

**Identifier:** BRN-012

application-awareness SHALL 指导 Pi 在新开发或本次修改所涉及的带 UI 应用中，使用户操作与 Agent Action 后的权威业务状态自动反映在相关界面，复用现有技术栈的简单可靠同步机制。同步 SHALL 不要求用户刷新整个页面，不把静态代码版本自动采用当作业务数据已同步的证明，不为普通数据更新重启/重新部署 Service 或触发新的 Agent 目标。UI 与 Agent SHALL 沿用同一业务逻辑及状态，不新增独立的前端业务事实源；加载此认知不触发对所有既有应用的自动改造。

正常同步 SHALL 保留无关的未提交输入与当前操作，不因轮询或局部更新反复清空草稿、关闭表单或打断焦点。同步失败 SHALL 按实际需要呈现可理解的失败/陈旧状态，不将旧内容冒充最新。具体周期与技术机制由实际应用决定，不要求所有技术栈采用同一实现；第三方软件继续遵循实际可观察和可控制边界。

默认模板 SHALL 提供业务 Query 失败与恢复的最小反馈：失败时保留最近确认内容并明确观察失败/数据可能陈旧，保护未提交输入及当前操作；恢复后重新显示权威状态并清除过期错误。SHALL 通过真实页面故障回归验证此路径，不以读取指导文字、代码版本已采用或正常同步测试替代。

#### Scenario: Agent 修改业务数据时页面保持打开
- **WHEN** Agent 通过既有 Action 添加或改变业务对象，用户仍停留在相关应用页面
- **THEN** 页面在正常同步后展示实际新状态，无手动刷新、Service 重启或额外模型 Run，原 Action 与验证依据保持可查

#### Scenario: 用户操作后更新当前视图
- **WHEN** 用户通过应用 UI 成功执行业务操作
- **THEN** 相关视图自动反映权威结果，不能仅显示提交成功而一直保留旧业务内容

#### Scenario: 同步时用户正在编辑
- **WHEN** 其他用户或 Agent 修改列表数据，而当前用户在未提交表单中输入
- **THEN** 相关业务显示可更新，无关草稿与当前操作得到保留；必要冲突按业务事实反馈，不无提示覆盖输入

#### Scenario: 同步失败与代码更新分别判断
- **WHEN** 页面已采用新版代码但业务查询暂时不可达
- **THEN** 界面不将旧业务数据视为已同步，Pi 分别报告代码生效和业务观察事实，不新增重部署或模型调用掩盖失败

#### Scenario: 业务查询恢复后保留草稿并更新状态
- **WHEN** 默认应用页面在 Query 失败后恢复可用，用户仍保有未提交输入
- **THEN** 页面清除失败/陈旧提示并自动显示实际业务状态，原草稿和当前操作保留，不要求手动刷新或启动额外 Agent 目标

### Requirement: 应用样式隔离并保留框架容器行为

**Identifier:** BRN-013

应用认知 SHALL 指导 Pi 为自定义 CSS 类采用业务前缀并尽量限定在应用作用范围，避免以全局 `.column`、`.row`、`.card` 等通用选择器误覆盖 UI 框架的布局或内部容器。确有目标的框架组件样式调整 SHALL 限定范围并核对实际效果，不能把无差别覆盖当作应用布局实现。有意的文档级背景/字体主题不属于误改内部容器。

脑包交付的默认 NiceGUI web-app/workstation 模板 SHALL 采用与该指导一致的自定义类名和选择器范围，保留已有业务及布局语义。样式隔离 SHALL 不变成新视觉设计系统、平台 CSS 门禁或对全部旧应用的自动重写。

#### Scenario: 自定义卡片与框架布局共存
- **WHEN** 默认应用为自己的卡片、标题或业务列表增加样式
- **THEN** 样式仅影响目标业务元素，框架行/列及页面内部容器保持可见和可操作，不受同名全局规则误改

#### Scenario: 默认模板示例遵循自身指导
- **WHEN** Pi 从脑包初始化 web-app 或 workstation 模板
- **THEN** 模板的自定义类和 CSS 使用业务前缀/局部范围，真实页面主要内容与操作可用，后续沿原页面版本和部署机制采用变更

### Requirement: 从实际用户入口验证页面并尊重能力边界

**Identifier:** BRN-014

应用认知 SHALL 区分服务就绪、HTTP 可达、业务接口可用与用户页面可用。对受影响的带 UI 应用，有可用且获准的浏览器能力时，Pi SHALL 从用户实际使用的 Desktop Service 入口确认内容可见、主要操作可用及业务状态自动更新；不得仅用 Service Ready、HTTP 200、Query 成功、截图文件存在或模型文字宣称界面验收通过。平台夹具中的浏览器能力 SHALL 不被当作任意 Work 已获授权的能力。

没有可用且获准的浏览器能力、真实入口不可达或授权不足时，Pi SHALL 明确区分已证实的后端结果与“页面未验证”及其原因，不宣称完整 UI 交付，不擅自安装浏览器、扩大权限、绕过入口授权或读取用户凭据。真实页面验证 SHALL 复用现有能力、原 Task/Run 与受影响页面范围，不增加独立审批或全页面巡检。

#### Scenario: Ready 和 HTTP 200 但页面不可用
- **WHEN** 服务就绪且 HTTP/业务接口正常，但 Desktop Service 页面内容被隐藏、遮罩阻挡或主要操作不可用
- **THEN** 页面验收不能通过，Pi 保留后端正常的事实并记录实际页面问题，不用就绪或接口结果覆盖该失败

#### Scenario: 通过实际 Desktop Service 完成基本交互
- **WHEN** 当前已有获准浏览器能力，用户请求的页面改动已部署
- **THEN** Pi 在原用户入口观察主要内容、执行受影响操作并确认数据自动变化，真实入口的授权/iframe/连接行为纳入结果，而不是仅打开 Service 的直接地址

#### Scenario: Work 没有浏览器能力
- **WHEN** 平台测试可以使用浏览器，但当前 Work 未提供可用且获准的浏览器工具或访问范围
- **THEN** Pi 明确页面尚未验证及实际限制，不把平台测试能力或后端检查当作本 Work 的界面验证，也不隐式安装或扩权

#### Scenario: 实际入口不可达或未获授权
- **WHEN** 浏览器存在但无法访问该 Desktop Service 入口，或该入口要求当前未获授予的身份
- **THEN** Pi 保留实际失败与已经确认的结果，不改用绕过授权的访问路径冒充真实入口验证，不泄露或擅取凭据

### Requirement: NiceGUI 页面异常按实际证据归因

**Identifier:** BRN-015

NiceGUI 专项认知 SHALL 指导 Pi 在空白页面或不可操作时检查与现象相关的资源加载、浏览器错误、HTTP/WebSocket 连接、内容 DOM、计算样式/尺寸、遮罩及层叠关系，并依据实际证据区分故障层。没有证据时 SHALL 保留原因未知，不直接归因为架构不兼容、iframe 不受支持或通过更换技术栈收尾。

诊断与修复 SHALL 保留可查观察并聚焦已证实的原因；不得借排障扩大权限、泄漏入口票据/凭据或采集无关用户内容。必要修复后 SHALL 从原实际入口重新检查受影响内容、操作与状态，不将改代码或换栈本身当成问题已解决。

#### Scenario: DOM 存在但样式或遮罩导致白屏
- **WHEN** 页面资源和连接可用，业务 DOM 存在但被 CSS、尺寸或遮罩影响而不可见/不可操作
- **THEN** Pi 取得相关样式/尺寸/遮罩证据并针对该原因修复，不能仅凭白屏判断架构不兼容；原入口重新验证基本可用性

#### Scenario: 资源或连接故障导致页面异常
- **WHEN** 实际入口出现资源失败、脚本错误或 HTTP/WebSocket 连接异常
- **THEN** Pi 根据实际浏览器和连接证据定位相应层，不能只改 CSS 或更换框架掩盖未解释的故障

#### Scenario: 证据不足时诚实收尾
- **WHEN** 当前可用观察不足以区分页面空白的原因
- **THEN** Pi 明确已经检查的事实、观察限制和未知原因，不伪造根因、宣称完整修复或自动更换用户技术栈
