## MODIFIED Requirements

### Requirement: Session 与 Run 的观察可恢复且不重复提交

**Identifier:** DWUI-004

Desktop SHALL 提供 Session 创建、列表、读取与切换，提交消息、文本/工具事件、Run 详情和显式取消，落实 DUL-012。标题使用真实首消息摘要或创建时间/ID。一个 Work 活跃 Run 的限制 SHALL 在其他 Session 提交前后都明确反馈，保留草稿且不建立隐藏队列。取消以当前 Run ID 为目标，取消中不预告终态。

断线恢复 SHALL 按原 Run ID 和事件游标查询/观察，重复事件去重；游标过期 SHALL 查询结果和 Session 历史，不重发 prompt。旧 context 不兼容 SHALL 提供 New session 并保留草稿，不自动迁移。停止 Work 不新取历史，页面已有内容标为旧内容。所有观察 SHALL 在切换身份、对象或页面卸载时释放本地连接，不取消远端执行。

手动 Run 与由显式 Service 请求受理的自动 Run SHALL 共用真实 Session/Run 历史和观察能力。自动处理记录与已经受理的 Run SHALL 分开表达：待处理或等待状态不等于正在执行模型；自动请求不是手动消息的隐藏队列。每个 Run SHALL 展示实际模型及执行来源，Service 来源 SHALL 能定位请求、已核验的事件/证据和当前阶段。关闭观察不取消请求；Cancel run 取消当前 Run，若关联未完成请求则同时结束其后续自动续接；Cancel request 可直接取消待处理、执行中或等待中的请求。

#### Scenario: 忙碌时保留输入
- **WHEN** 同一 Work 的另一 Session 正在执行而当前 Session 发送失败为 busy
- **THEN** 显示活动执行入口并保留草稿，不排队、不取消旧 Run

#### Scenario: 断线与游标过期
- **WHEN** 事件观察断开，恢复请求报告游标过期
- **THEN** 从原 Run 结果和 Session 历史恢复，只呈现一次已有输出，不发第二次消息

#### Scenario: 取消与成功竞争
- **WHEN** 用户取消时 Core 已经成功完成 Run
- **THEN** 最终显示 succeeded，不能以本地取消请求覆盖真实结果

#### Scenario: 等待请求不是活跃 Run
- **WHEN** Service 请求等待 Job 完成，而当前 Work 没有活跃 Run
- **THEN** 显示等待对象和最近确认时间，手动聊天可以正常受理，不将等待展示为模型持续执行

#### Scenario: 取消范围可辨
- **WHEN** 用户打开自动 Run 的详情
- **THEN** 能分别识别当前 Run 和来源请求的状态与取消影响，取消请求后不得再自动续接

### Requirement: Service 管理与数据上下文清楚分离

**Identifier:** DWUI-005

Desktop SHALL 实现 DUL-004、006、013：Service 列表/详情包含禁用、失败、非 Web 服务，提供公开域名/端口、Start/Stop/Restart/Retry/Remove 和有界日志刷新，访问行为遵循 `browser-service-access`。Stop 是持久禁用，Start 不启动停止的 Work，Remove 保留共享文件且无法以 Start 撤销。日志 SHALL 显示取得时间、截断及不可用原因，不伪装实时终端。无效动作说明原因，控制完成以原 Operation 为准。

所选 Service SHALL 只提供明确的身份上下文，不自动读取或上传页面 DOM、输入、截图和内存。用户请求分析时 SHALL 通过 Agent 的实际文件/API 能力取得数据，并要求回答说明来源；无来源时说明不可访问，不声称浏览器已同步数据。现有 Service 创建/定义更新仍由 Agent 工作流完成。

Pi 开发且实现交互契约的 Service SHALL 可以主动记录页面路径和业务动作，并向 Agent 提交显式请求；这些事实由 Service 的事件/API 提供，不是 Desktop 对任意网页的监听。Service 详情和 Chat SHALL 能查询该 Service 的处理记录、事件来源和证据；仅有普通事件不启动自动 Run。未接入契约的外部 Service SHALL 只显示平台已经确认的状态、日志、可访问性以及 Agent 实际读取到的外部信息，不声称掌握其内部用户操作。

#### Scenario: 非 Web 和禁用 Service
- **WHEN** 服务没有可用 Web 端口或被禁用
- **THEN** 仍可查看详情/日志和有效控制动作，不能因为不可预览就隐藏服务

#### Scenario: 移除后文件仍保留
- **WHEN** 用户确认 Remove Service 并观察到成功
- **THEN** 服务消失但共享 workspace 不被 UI 描述为已删除，恢复定义仍需 Agent 操作

#### Scenario: 请求分析 Service 数据
- **WHEN** 用户操作应用后在聊天中请求分析
- **THEN** 明确传递 Service 身份而非页面内容，实际读取文件/API 后说明来源，数据不可达时不编造结果

#### Scenario: 两类 Service 的观测边界
- **WHEN** 同一 Work 包含接入契约的应用和未接入的外部 Service
- **THEN** 前者可显示其提供的页面路径、业务事件与请求回执，后者仅显示已经取得的外部信息，界面不自动采集两者 DOM 或输入内容

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Settings SHALL 按 DUL-014 完整提供 Skills 目录与 Work 选择/清空、AGENTS 当前/待应用内容及导入编辑、Advanced 完整 JSON show/set、Pi Package 目录及 Work 已安装项。In use、Saved changes、Not applied、runtime loaded/modelVisible SHALL 各自对应真实状态。目录不可编造说明；重选 Core 副本与保留 Work 副本的语义须明确。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

piwork-brain SHALL 使用现有 Pi Packages 与 Files 产品流程。Files 中 `.pi/packages/piwork-brain/` 是可编辑源；Settings 中 loaded/modelVisible 对应 active 捕获包，不能因文件已修改就宣称采用。候选详情 SHALL 展示来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态，区分包已加载与实际 SDK 行为已核验。用户显式 Apply 期间仍允许后续配置编辑；晚返回候选不得覆盖无关的新 desired。自动验证只能在有效加载之后运行，不能在 Apply 初始化中调用模型。

候选详情 SHALL 在现有 Package Details 分项展示受理时 active/desired 选择与当前匹配摘要、固定目标及能力、安全输入摘要和必要 checks、准备发布结果、对应 Apply 原 ID/状态，并能按原 ID 打开既有请求/Operation 详情。内部 context identity、制品 digest、凭据和宿主路径 SHALL 不成为展示字段。没有匹配 Apply、观测不可用、加载失败与行为失败 SHALL 分开，不能用 Saved/Loaded 标签或缺字段 JSON 代替这些信息；打开或刷新详情不提交修改，也不重载 Service iframe。

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS/Advanced 内容
- **THEN** 原 Operation 只激活其已接受候选，新编辑仍 Not applied

#### Scenario: 已加载但未完成脑包验证
- **WHEN** 候选 Apply 成功且运行时已加载包，但实际 SDK 目标工具输出尚未通过检查
- **THEN** Package 显示真实加载状态，请求继续显示验证阶段，不显示整个更新已完成

#### Scenario: 候选晚返回与用户新编辑
- **WHEN** 候选准备期间用户保存了无关的 Skills 或 AGENTS 修改
- **THEN** 候选发布保留这些新编辑，冲突的脑包基线单独报告，原 Apply 与后来编辑分别呈现

#### Scenario: 候选详情包含原验收项与 Apply
- **WHEN** 用户打开已准备候选详情，包括无关保存后 Apply 加载失败的候选
- **THEN** 可读到原受理基线、固定能力/输入摘要/必要 checks、准备结果和实际对应的 Apply ID/状态；可按原 ID 查请求与回退依据，Service 页面及当前 Session 不被刷新或替换

## ADDED Requirements

### Requirement: Chat 模型选择遵守下一次受理语义

**Identifier:** DWUI-MODEL-001

Desktop SHALL 在现有 Chat 输入区提供当前 Session 的下一次手动 Run 模型选择，来源为 Go Core 与实际 SDK 共同确认的可用模型，包含 Use Work default。保存 Session 偏好 SHALL 不触发 Apply、重建 Session、取消 Run 或立即发送消息。已受理 Run 的实际模型 SHALL 保持不变；自动请求 SHALL 使用该 Run 受理时 Work active 默认模型，不继承手动 Session 偏好。选择器及详情 SHALL 不公开密钥、私有路径或绑定凭证。

加载、保存、发送、错误和恢复 SHALL 沿用 DWUI-011、012、014、017、018、019 的对象归属、即时反馈、身份隔离及原 ID 规则。偏好保存尚未确认时 SHALL 不受理依赖该新选择的发送；失败保留草稿与已确认偏好，不将 UI 临时选项当作服务端事实。失效模型 SHALL 明确阻止新受理并提示选择可用项，不静默换模型。模型或偏好读取晚返回 SHALL 不覆盖切换后的 Work/Session；已受理的提交即使刷新失败也 SHALL 保留 Run ID 和 submissionKey，不重发 prompt。

偏好保存响应丢失或无法确认是否已写入时 SHALL 显示结果未知并保留原 Session 和所选值；Check status SHALL 读取当前 Session 的实际偏好，不重新发送 PATCH 或 prompt。确认当前偏好之前 SHALL 禁止依赖该保存结果发送；查询失败保持未知和草稿，明确拒绝且可证明未写入时才恢复原已确认偏好。

#### Scenario: 当前执行中修改下一次模型
- **WHEN** 当前 Run 使用模型 A，用户保存当前 Session 的模型 B 偏好
- **THEN** 当前 Run 仍显示 A，下一次新手动 Run 在偏好保存确认后使用 B，Session 不变

#### Scenario: 偏好保存失败
- **WHEN** 用户选择 B，但保存返回鉴权或服务错误
- **THEN** 显示归属该 Session 的错误，草稿保留，后续发送不假定 B 已保存

#### Scenario: 默认与自动处理
- **WHEN** 用户将 Session 设为 Use Work default，随后有 Service 自动请求被受理
- **THEN** 手动和自动 Run 各自显示其受理时的真实模型，旧历史不随默认值变化

#### Scenario: 偏好保存响应丢失
- **WHEN** 保存可能已写入但响应丢失，随后查询也暂时失败
- **THEN** 显示未知结果并保留草稿，发送暂不可用；按原 Session 查询成功后显示其真实偏好，不重复 PATCH 或自动提交消息

### Requirement: Service 处理记录与证据在现有工作区闭环

**Identifier:** DWUI-FEEDBACK-001

Desktop SHALL 在 Chat 及对象详情中提供当前 Work 的处理记录列表与详情，可按 Service 范围分页查看真实请求、来源事件、关联 Runs、等待对象、终态、错误和证据；证据 SHALL 表达观测时间、状态/代码版本及验证结论。分页 SHALL 使用服务端有界查询和游标，不在浏览器加载全部历史。自动 Session SHALL 可以进入现有 Session/Run 观察，不新增顶层工作流导航或独立执行控制台。

Cancel request 和 Retry request SHALL 是明确且作用域可辨的操作。取消 SHALL 阻止后续自动 Run；重试 SHALL 使用稳定的新 submissionKey 生成关联原请求的新请求，而不是复用未知结果的 Action。响应丢失 SHALL 查询原请求/提交结果，不自动生成第二次重试。导入的 historical 请求 SHALL 展示历史标记并禁用直接 Retry；用户可另行明确提出新的目标。Stop/Apply/Delete 准入失败 SHALL 显示真实原因，不暗中 Start、Apply 或取消其他 Run。

该工作区 SHALL 延续 master 的本地反馈、对象级锁、关闭只停止观察、跨身份清除及已受理 ID 恢复规则；页面状态刷新 SHALL 不重载 Service iframe。处理记录是领域记录，SHALL 不混入通用 UI 读取成功流水；请求状态未知 SHALL 显示最近确认值与 Check status，不能猜测成功或失败。

#### Scenario: 查看一次异步处理的闭环
- **WHEN** Service 请求从受理、Action、等待 Job、验证到完成
- **THEN** 详情关联来源事件、真实 Run/Action/Job 与结果证据，等待期间可继续手动聊天，终态能追溯验证依据

#### Scenario: 重试响应丢失
- **WHEN** 用户显式 Retry request 后失去响应
- **THEN** 保留原请求和本次 submissionKey 并查询已受理结果，不自动生成第二个请求

#### Scenario: 导入历史不参与自动处理
- **WHEN** 用户打开导入 Work 的来源请求与证据
- **THEN** 能完整阅读历史，直接重试不可用，Work 启动不会因此产生自动 Run
