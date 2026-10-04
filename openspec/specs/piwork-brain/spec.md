# piwork-brain 规范

## Purpose
定义每个 Work 默认拥有的 Pi 大脑包，使 Agent 在开发和维护工作站时持续具备状态、Action、Event、反馈、验证和证据的认知，并让已经验证的服务改进与 Work 经验在后续执行和完整环境分享中得到真实采用。

## Requirements

### Requirement: 安装并实际加载 Work 自有的大脑包

**Identifier:** BRN-001

系统 SHALL 将 `piwork-brain` 作为本地 Pi extension package 管理，Work 内安装源及可编辑副本 SHALL 位于 `.pi/packages/piwork-brain/`，包内 SHALL 包含 extension、默认认知、Skills、Tools 和支持文件；不得将其交付为用户需通过 npm 安装的 Node module。实际执行 SHALL 使用当前 active context 已捕获且验证的包资源，编辑工作区副本不得直接热更新正在运行的包。

全新安装完成默认能力准备后，省略 package 选择的新 Work SHALL 独立拥有并启用脑包，ready 前 SHALL 验证真实资源及工具加载。包目录存在、catalog 安装成功或同名独立 Skill 加载均不得替代该验证。显式 packages=[] SHALL 保持空集合；独立 skills=[] 不得移除已选择脑包提供的 Skills。既有 Work SHALL 通过显式包安装/选择及 Apply 采用脑包，不能静默改写原 active、desired 或镜像。默认种子 SHALL 有一次性完成记录，保留管理员对默认集合和包内容的后续修改。

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

### Requirement: 在默认认知中嵌入完整工作站开发规则

**Identifier:** BRN-002

启用的脑包 SHALL 在每次新建或恢复的执行上下文中提供默认认知：发现当前 Work 的能力与资源、区分外部 Service 与 Pi 开发维护的 Service、设计可查询状态和可执行 Action、记录页面路径及业务动作、明确何时请求 Pi、支持异步结果、验证实际效果并回写证据。不得仅依赖模型自行选择部署 Skill 才获得这些认知。

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

### Requirement: 读取可变 Work 经验并确认实际采用

**Identifier:** BRN-003

系统 SHALL 将可变 Work 经验与 immutable 包、AGENTS context 和 Service 业务数据分开保存。经验 SHALL 携带稳定标识、适用 Service 或 Work 范围、依据、版本和生效时间；经验证的观察须引用可查询证据，用户明确偏好须引用原请求。自动形成的经验 SHALL 在对应改进验证通过后提交，失败候选不得作为已确认经验采用。

每次后续执行 SHALL 在模型调用前读取当前有效经验，并记录实际采用的经验版本；已有兼容 Session 和 New session 均适用，不要求重新 Apply 包。已接受 Run SHALL 保持其开始时的经验快照。读取失败或格式损坏 SHALL 明确阻止依赖脑包的执行，不得用空经验伪造正常采用。经验内容不得隐式扩大工具权限或更改平台模型凭据。

有效经验 SHALL 最多 100 条，每条规则最多 4 KiB；超过限制须明确要求合并或替换，保留原有效版本，不静默截断、丢弃或无限扩展模型输入。

#### Scenario: 新 Session 采用已验证的经验
- **WHEN** Pi 验证复盘改进并保存相应经验，用户在新 Session 再次生成复盘
- **THEN** 新执行读取并记录该经验版本，结果和执行依据可以证明规则被采用

#### Scenario: 验证失败的学习候选
- **WHEN** 一次服务改进未通过验证
- **THEN** 原有效经验保留，失败候选及其原因可查但不进入后续默认认知

#### Scenario: 执行中提交了新经验
- **WHEN** 当前 Run 已开始后另一个已确认来源提交新经验
- **THEN** 当前 Run 保持开始版本，下一次 Run 读取新版本

#### Scenario: 经验容量达到限制
- **WHEN** 新有效规则超过条数或单条大小限制
- **THEN** 提交明确失败并给出合并或替换方向，原有效版本保持可读，不宣称新规则已经采用

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

需要更新脑包 Skill/Tool 的任务 SHALL 能由 Pi 准备当前 Work 的同名候选包，通过既有包准备流程更新 desired，并显示等待显式 Apply。Apply 成功后 SHALL 在新 active context 的兼容 Session 中确认资源实际加载和相关能力可用，再回写更新完成；失败、被取代、候选被移除和验证超时 SHALL 明确收尾，不得自动 Apply、改绑旧 Session 或重新写回已被用户替换的 desired。包准备、Apply 和采用验证 SHALL 全部在本版可完成。

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
