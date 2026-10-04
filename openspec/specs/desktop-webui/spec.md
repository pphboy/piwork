# Desktop WebUI Specification

## Purpose

使 Work 所有者通过 CLI 启动的本地浏览器界面完成工具使用、Agent 对话、共享文件和 Work 维护，落实统一产品语言，并为认证、长任务、大文件传输及失败恢复建立可测试的运行契约。

## Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除该平台身份派生的内容授权、关闭相关内容流并进入登录恢复页面；仍有效的浏览器本地控制会话 SHALL 保留用于重新登录，不要求重启 Desktop。普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销该平台身份的本地内容访问并说明未确认远端撤销，禁止显示远端撤销成功。

Desktop SHALL 分别表示浏览器本地授权、Core 用户会话与连接状态。本地授权缺失时不展示可提交的账号登录、注销、切换 Core、已知操作或 Inspect 控件，也不展示 CLI 保存的身份；提供 DWUI-014 的本地恢复入口。正常 Sign out 清除该 Desktop 当前平台登录，保持仍有效的本地控制会话，以便输入另一账号；其影响包括该实例中使用同一平台身份的其他已授权浏览器，不影响持有其他 Core 会话的客户端。

#### Scenario: Core 可达但运行环境失败
- **WHEN** 健康接口正常而运行依赖不可用
- **THEN** 登录和可用控制信息仍可使用，创建/启动显示真实限制，不把连接状态写成全部 Ready

#### Scenario: 过期后重新登录
- **WHEN** 用户在观察已接受的 Import 时会话过期，随后重新登录同一账号
- **THEN** 内容访问中止后恢复原 Operation 查询，Import 不被再次提交

#### Scenario: 切换 Core 或用户
- **WHEN** 用户从 Core A/用户 A 切换到 Core B 或用户 B
- **THEN** A 的 token、文件内容、对话和活动不被发送给或展示为 B 的内容

#### Scenario: 本地授权有效而 Core 会话过期
- **WHEN** Core 明确拒绝当前会话，但浏览器本地控制会话仍有效
- **THEN** 显示可提交的账号登录表单，旧内容和派生连接被撤销，重新登录不需要新启动链接或重启 CLI

#### Scenario: 本地未授权不能伪装成账号登录
- **WHEN** 浏览器没有可用本地授权，或账号动作被本地授权校验拒绝
- **THEN** 显示本地授权恢复页，无法提交的账号菜单与表单不出现；明确原因和可执行恢复动作，不能把错误描述为密码错误

### Requirement: 以统一语言组织可操作的 Work 工作区

**Identifier:** DWUI-002

Desktop SHALL 落实 DUL-001—007、DUL-010、DUL-016 的对象、容器、英文文案和 Serve 浅色视觉规则。Work List SHALL 独立展示搜索、New Work、Import、账号、按 ID 查询操作与对齐的状态/动作列。打开 Work SHALL 直接进入专属面板，无跨 Work 侧栏或强制概览；Service/Files/Chat 为同级入口，Settings 明确可达。

可用 Service SHALL 为默认主区域，同一 Session 的 Agent 输入保留在辅助栏；无可用 Service 且对话准入成功则聚焦 Chat。停止状态 SHALL 展示 Start、配置、Export 与历史保留提示，不新读历史。切换区域 SHALL 保留当前 Service/端口、Session 和本页面非敏感草稿；不承诺任意应用内部未保存表单的恢复。所有列表 SHALL 区分加载、真正空集合、错误和带时间的旧内容。

共同颜色/字阶/间距/控件 SHALL 可集中修改；360px 无整页横向溢出，长名称和技术标识可完整读取/复制，危险/编辑弹层按 DUL-007 管理焦点及未保存确认。交付 SHALL 提供原型 36 帧/CLI 能力矩阵到实际界面与验收记录的对应关系。

#### Scenario: 从列表进入并切换区域
- **WHEN** 用户打开有就绪 Service 的 Work，切到 Files、聚焦 Chat，再返回 Service
- **THEN** 始终保留 Work 身份，Service 为原选择，对话使用同一 Session 和草稿，不产生额外 Run

#### Scenario: 错误不是空列表
- **WHEN** Work 查询失败或返回空数组
- **THEN** 分别显示错误恢复入口或 New Work/Import 空态，不用零计数覆盖查询失败

#### Scenario: 列表与窄屏可操作
- **WHEN** 多种状态、长名称 Work 在宽屏及 360px 显示，用户通过键盘操作行按钮
- **THEN** 状态/动作保持可读且布局对齐，按钮不同时触发行导航，焦点与弹层返回位置正确

### Requirement: Work 创建与生命周期使用真实控制结果

**Identifier:** DWUI-003

New Work SHALL 提供必需名称与默认创建，以及高级镜像、Skills/Packages 默认/选择/显式清空、AGENTS 文件/文本和完整配置 JSON；字段省略与空集合语义、合并顺序 SHALL 与现有用户 CLI 一致。校验失败保留输入，接受后显示 Work/Operation ID 与准备状态。

列表和 Work 面板 SHALL 支持 Start、Stop、Retry、Delete、公开身份及详情，遵守 DUL-008。Stop 确认影响当前 Run、Service 和文件连接；Delete 确认默认保留数据、不提供假撤销。仅 desired=running 的失败提供 Retry；停止失败查询原 Stop，不将目标改回运行。accepted、running、succeeded、failed、superseded 和 unknown SHALL 分开；删除后即使 Work 已不在列表，原 Operation 仍可查询。

#### Scenario: 默认创建和显式空集合
- **WHEN** 用户分别使用默认配置及显式空 Skills/Packages 创建
- **THEN** 前者采用 Core 默认，后者不被默认填回；成功准备前不显示 Ready

#### Scenario: 停止取代启动
- **WHEN** Start 尚未完成时 Stop 已接受且旧 Operation 被取代
- **THEN** 当前目标为 stopped，旧操作显示 superseded，不能继续以旧结果显示 Ready

#### Scenario: 停止失败与删除
- **WHEN** 停止失败，或删除已接受而 Work 已离开列表
- **THEN** 前者不可 Export 且可查询原 Stop；后者保留 Delete 观察入口，不提前宣布清理完成

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

### Requirement: 浏览器文件操作覆盖共享 workspace

**Identifier:** DWUI-006

Files SHALL 以当前 Work 的整个共享 workspace 为根（包含隐藏项），通过本地认证入口调用 Core WebDAV；仅运行且文件准入成功时可读写。SHALL 实现 PROPFIND 列目录、GET 下载/文本读取、PUT 上传/保存、MKCOL、同 Work MOVE/COPY/DELETE，准确处理 Destination、Location、DAV href、中文与百分号路径及逐项错误。工作根不可删除、移动或重命名，符号链接/特殊项按真实类型限制，不能穿越根或跨 Work。

文本编辑 SHALL 限于至多 1 MiB、合法 UTF-8 且不含 NUL 的普通文件；超限或二进制提供 Download。编辑不自动保存，不承诺锁/ETag/自动合并，离开前明确 Save/Discard/Keep editing；保存前展示并发覆盖风险，已知修改时间可用时携带条件请求，冲突先重读，不自动覆盖。上传逐文件显示结果，已存在目的地须明确覆盖；目录操作可递归时先说明影响。

SHALL 遵守 Core 文件限额及单 Work mutation 并发限制；浏览器默认逐文件上传，无隐式写入重试。`207` 展示成功/失败路径，未知写入要求重读实际目录。普通下载不表示一致性备份，不提供目录 ZIP 或跨 Work 操作。文件能力缺失 SHALL 只局部降级。Connect with WebDAV SHALL 展示现有 proxy 命令、完整 Work URL 和终端临时密码获取方法，浏览器 Files 不依赖该流程。

#### Scenario: 文件读写全流程
- **WHEN** 用户建目录、上传、编辑、重命名、复制、移动并下载文件
- **THEN** 相应 WebDAV 操作作用于同一 workspace，内容一致且浏览器不持有 Core token 或外部 WebDAV 密码

#### Scenario: 大文件、特殊项及越界
- **WHEN** 用户尝试编辑超限/非 UTF-8 文件、符号链接，或修改根及跨 Work 目标
- **THEN** 合法普通文件可下载，非法编辑/目标给出原因并在写入前拒绝

#### Scenario: 覆盖冲突和响应丢失
- **WHEN** 文件保存发生条件冲突，或 PUT 已发出但结果丢失
- **THEN** 保留本地编辑，提示重读/比较，不能自动再次 PUT 或声称回滚

#### Scenario: 目录部分失败和后端缺失
- **WHEN** 目录请求返回 207，或 Core 文件后端不可用
- **THEN** 前者显示逐路径结果并刷新；后者只禁用 Files，仍允许可用 Service 与 Work 控制

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

### Requirement: 完整 Work 包可以本地检查和原子导入

**Identifier:** DWUI-008

用户 SHALL 能选择 `.work` 在本地完整 Inspect，无需 Core 登录、不执行包内代码，显示既有安全摘要和私有内容提醒，允许检查后直接关闭。上传与检查 SHALL 流式处理并遵守现有 `.work` 格式、完整校验及容量限制，不将整个包放进浏览器/CLI 内存。

Import SHALL 复用检查后的同一包，提交前校验仍一致；名称留空真正省略，显式冲突定位名称字段；目标权限与模型兼容由 Core 校验。上传不虚构 Operation；接受后保留原 ID，发布前/失败时无半成品 Work。成功展示最终名称、新 ID、stopped 以及分开的 Open Work/Start Work。不自动运行 Service 或包代码。取消未提交传输可清理本地暂存；取消观察不撤销已接受 Import。

#### Scenario: 离线检查后关闭
- **WHEN** 未登录用户选择合法或损坏的本地包
- **THEN** 本地分别显示完整验证摘要或具体校验失败，不连接 Core 或执行内容，关闭后清理暂存

#### Scenario: 自动名称和显式冲突
- **WHEN** 导入同名包时分别留空名称或显式填入冲突名称
- **THEN** 前者由 Core 选择名称，后者保持表单并提示冲突，不覆盖旧 Work

#### Scenario: 导入完成或失败
- **WHEN** 已接受 Import 进入终态
- **THEN** 成功才显示 stopped 新 Work，失败保留 Operation 和原因，均不自动 Start

### Requirement: 导出与下载保持显式阶段及原快照恢复

**Identifier:** DWUI-009

Export SHALL 按 DUL-009 分为 Stop Work、Prepare package、Download。仅 desired/observed 均 stopped 且无已知冲突时可提交，最终准入以 Core 为准；不得自动 Stop/Apply/取消 Run。接受后保留 Operation/snapshot ID，成功且完整校验后可下载。完整 `.work` 使用既有快照格式，包含 workspace 及格式定义的其他持久内容，文件浏览下载不能替代它。

下载 SHALL 复用原 snapshot，流式传输、核验长度/hash，失败不能显示保存完成；过期明确提示用户重新发起 Export，不静默创建快照。SHALL 提供按 snapshot ID 找回下载。浏览器下载动作仅能确认发起时显示 Download started，不宣称实际落盘完成；敏感包提醒在下载前可见。临时空间不足必须可见且不删除 Core 已生成快照。

#### Scenario: 运行中请求导出
- **WHEN** Work ready 或 stopping 时用户进入 Export
- **THEN** 提示先独立 Stop 并等待，无 Export/隐式 Stop 请求发出

#### Scenario: 状态显示停止但 Core 拒绝
- **WHEN** Core 发现实际写入者或快照锁而拒绝 Export
- **THEN** 显示安全原因和恢复入口，不提供半成品下载

#### Scenario: 下载断开或过期
- **WHEN** 下载失败后用户重试，或快照已过期
- **THEN** 有效快照使用原 ID；过期显示明确原因，需要用户重新 Export，不自动重做

### Requirement: 已知操作恢复不形成隐式任务队列

**Identifier:** DWUI-010

Desktop SHALL 提供 Operation ID 查询和按需活动区，覆盖 Work、Service、Apply、Packages、Import、Export。已接受操作持久记录仅含 Core/用户归属、类型、相关身份 ID 和时间；页面重载后重新查询原对象，不能称为全局历史。记录不得包含凭证、提示词、文件正文、包字节或来源秘密。未知结果 SHALL 保留最后确认时间、原 ID 和 Check status；无 Operation ID 的未知提交不能自动再发，提示核对对象状态。

多窗口与观察重连 SHALL 不导致重复 mutation。请求进行时防重复点击，离开或关闭仅取消本地观察；有幂等键的提交保持该次键且不用于新意图。读失败采用有界退避，鉴权失败进入恢复，404/410 不无限重试。用户可清除本地记录，不改变 Core 对象。

#### Scenario: 删除后重载
- **WHEN** Delete 已接受且列表已无该 Work，用户刷新页面
- **THEN** 从当前身份已知记录恢复原 Operation，仍可查看清理结果

#### Scenario: 提交响应丢失
- **WHEN** 控制请求已发送但未取得 Operation ID
- **THEN** 显示结果未知并引导核对状态，不自动再次提交，不虚构 ID 或失败终态

#### Scenario: 多窗口观察同一任务
- **WHEN** 两个窗口恢复同一个已知 Operation
- **THEN** 二者只查询该任务，无新增 mutation，切换身份后不读取旧身份记录

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、Known operations、Operation/snapshot 查询、清除已完成记录 |

收到原 Operation/Run acceptance SHALL 立即展示其 ID、对象及 Accepted，不能等待后续 Work、列表、日志或配置读取才展示。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** 原 ID 和 Accepted 已可见，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

#### Scenario: 读取不是空数据
- **WHEN** 用户打开 Work、Files、Settings、Session 或日志且请求尚未返回
- **THEN** 目标与读取状态可见，旧内容标记为最后已知，未确认列表不写成空集合/零计数；成功空集合、404 和读取失败各有不同的下一步

#### Scenario: Run 提交与请求取消
- **WHEN** 用户 Send 或 Cancel run，接受响应被延迟
- **THEN** 对应输入/Run 上显示 Submitting message 或 Requesting cancellation，保留草稿/原 Run；接受后显示真实 Run 状态，取消与成功竞争以真实终态为准

#### Scenario: 保存确认与读回分离
- **WHEN** 文件 PUT 或配置保存已被可靠确认，随后版本/配置读取失败
- **THEN** 已确认写入事实保留，界面明确版本/当前配置未确认，草稿和新编辑不丢失；不重复写入、不以旧时间授权下一次覆盖、不暗中 Apply

#### Scenario: 未变化的检查与快速完成
- **WHEN** 手动查询成功但返回相同状态，或请求立即完成
- **THEN** 查询确认时间/简短结果可辨，快速完成不增加人为等待；菜单与复制继续使用既有即时结果

### Requirement: 等待状态按对象防重复并允许离开和独立操作

**Identifier:** DWUI-012

Desktop SHALL 只限制该提交的重复入口和同对象的冲突修改，禁止用一个异步动作禁用整页按钮。同一 Work 文件修改串行，同一 Service 控制提交串行，同一配置提交串行；同 Work 生命周期提交期间限制冲突写入。取得 acceptance 后提交锁 SHALL 释放，后续准入仍按真实对象状态及既有控制语义，允许合法 Stop 取代未完成 Start；不能将 Operation 观察当作全局锁。身份变更提交期间阻止新的平台修改，既有匿名 Inspect 规则保持。

Service 控制提交的对象 SHALL 按发起时的 Work 与 Service 身份绑定，不包含浏览器入口端口。切换端口、关闭再打开详情或换用另一控制入口不能绕过同一 Service 的在途冲突锁；其他 Service 的合法动作保持可用。Service 预览、入口准备及其缓存仍按 Work/Service/port 区分。

等待期间 SHALL 保留普通 Close/Back、复制及无关对象的合法动作，导航仍检查脏草稿。关闭普通详情或离开模块只结束当前展示/读取观察，不暗中取消远端 Operation、Run 或已提交修改。未提交 Inspect 的 Cancel/Escape 仍释放本地暂存；提交中/未知/已接受 Import 保留原身份并只停止展示。界面 SHALL 明确这些不同的关闭含义。

反馈 SHALL 绑定发起时的 Core/账号、Work/对象及该次动作。切换对象后晚结果不能打开旧弹层、覆盖新内容/草稿或显示为新对象的成功；同身份已接受操作仍能按原 ID 找回。新身份不得取得旧内容或传输。失败/终止后 SHALL 释放相应等待状态，保留已有安全约束；未知修改不能通过重新启用按钮暗示可直接再次提交。保存期间允许继续编辑时，成功只确认已提交草稿，新编辑仍为 Unsaved。

未知修改的只读核对 SHALL 匹配原 Core/账号、Work、动作及涉及资源，并依据实际返回对象判断核对范围。查询其他 Work 的 Operation、同 Work 的无关 Operation 或未确认关联关系的记录不得解除原动作的未知结果锁；不得因为一次查询成功而批量解除当前 Work 的生命周期、传输和 Agent 锁。已有接口能够确认原目标的当前事实或原业务身份时，才可恢复对应动作的既有准入，并保留原提交结果未知与当前事实已核对的区别；无法确认时继续提供原对象核对入口，不自动重发、不暗示可直接重试。

#### Scenario: 等待下载时关闭或执行独立动作
- **WHEN** 当前 Work 的下载准备尚未完成，用户关闭 Export 并查看另一 Work
- **THEN** Close/Back 可操作，另一个 Work 的合法动作不被禁用；原准备不会自动再次提交，原结果可在原上下文找回，完成不会在新页面自动触发下载

#### Scenario: 文件选择入口防重复
- **WHEN** 同一 Work 正在上传，用户再次通过文件选择或键盘触发上传/删除
- **THEN** 第二个冲突修改未发出，当前上传和原因可见，不建立隐藏队列；其他 Work 的合法操作不受此锁限制

#### Scenario: 晚返回与继续编辑
- **WHEN** 用户切换 Work/Core/账号，或在 Save 期间继续编辑，旧动作随后返回
- **THEN** 旧反馈不进入新对象或新身份；同对象保存只确认提交版本，新草稿保留；旧请求的结束不会释放另一动作的锁

#### Scenario: Operation 观察与目标取代
- **WHEN** Start 已接受并正在观察，用户在既有准入下显式 Stop
- **THEN** 可以提交新的停止目标；两个 Operation 身份分别保留，旧 superseded 不被描述为当前启动成功

#### Scenario: 切换端口不绕过 Service 控制锁
- **WHEN** 同一 Service 的 Restart 响应尚未返回，用户关闭详情、切换浏览器端口并重新打开该 Service 的控制入口
- **THEN** 第二个冲突控制请求不会发出，原目标与等待原因仍可查看；其他 Service 的合法控制不受此锁限制，预览入口仍按所选端口区分

#### Scenario: 未知结果核对仅恢复对应原对象
- **WHEN** Work A 的 Start 返回结果未知，用户查询 Work B 的 Operation 或 Work A 的无关 Operation，随后核对原目标
- **THEN** 无关查询不会解除 A 的未知结果锁或产生第二次 Start；只有匹配原身份、动作对象且能够确认相关事实的核对才恢复对应准入，原提交未知不被改写为确定成功，其他未知动作不被批量解除

### Requirement: 传输的等待与进度在所属流程中可见

**Identifier:** DWUI-013

Files 上传 SHALL 在开始目标检查时显示当前文件/总文件数，并展示真实已发送字节或不可量化的 Uploading，逐文件串行且最终结果按路径呈现。只有浏览器发送完成时不能宣称 Core 已保存；等待响应时显示 Waiting for confirmation，部分失败/未知保留未成功输入及既有条件覆盖规则，不自动重传。

Pi Package 本地目录/ZIP SHALL 在安装弹层展示浏览器到 CLI 的真实上传、等待本地校验及传送、随后提交 Core 接受的不同事实；没有 CLI 到 Core 的字节数据时只显示阶段。Core/npm/Git 来源的提交也 SHALL 有等待反馈，acceptance 后才进入原 Operation 观察，安装成功不等于 Apply/loaded。

`.work` 下载 SHALL 在点击后立即显示本机下载准备，随后按已有原 snapshot/transfer 显示 downloading/validating/ready、已知字节及查询时间。准备响应尚未返回也 SHALL 可以观察进度；total 未知时不得伪造百分比或用零代表真实大小。下载读取/校验失败与观察失败分别反馈；观察失败保留原 transfer/snapshot，显式重新查询不创建新快照、不重复准备。已准备的同一 transfer SHALL 可继续发起浏览器内容下载，发起后只显示 Download started，不声称落盘完成。

关闭 Download 弹层不隐式取消原准备；完成后在原 Export/已知活动上下文提供 Download，不在其他页面自动弹出保存。页面卸载、本地身份失效或 CLI 退出的传输边界沿用现有行为，不能承诺后台跨进程续传。Inspect/Import 的已有本地检查与明确提交、释放及未知恢复保持 DWUI-008 与既有修复规则。

#### Scenario: 文件上传发送完成但等待确认
- **WHEN** 文件上传字节已发送，而 WebDAV 响应尚未返回
- **THEN** 当前路径显示等待保存确认，成功计数不提前增加，重复/冲突修改受限，返回成功后才更新结果

#### Scenario: 本地 Pi Package 阶段
- **WHEN** 用户从目录或 ZIP 安装/更新包
- **THEN** 响应前可见真实上传和后续等待阶段，取得 Operation 后立即显示 Accepted；不把上传完成写成安装/加载完成

#### Scenario: 下载 POST 尚未结束
- **WHEN** CLI 正在从原 snapshot 拉取和验证 `.work`，初始准备请求尚未返回
- **THEN** Export 显示对应 transfer 的实际进度/阶段，Close 可用，尚未提供未校验内容下载，未新增 Export

#### Scenario: 下载观察丢失与继续
- **WHEN** 下载状态查询失败后用户显式 Check transfer，随后原 transfer ready
- **THEN** 保留原 snapshot/transfer 和最后确认时间，仅重新查询原传输，提供同一内容下载，不重新提交准备或声称文件已落盘

#### Scenario: 有界本地等待与未知总量
- **WHEN** 进度没有 total，或已等待十秒但未取得新确认
- **THEN** 分别显示不可量化阶段或仍在等待确认及已等待时间，不假造百分比、超时失败或新的修改请求

### Requirement: 本地授权初始化与恢复形成闭环

**Identifier:** DWUI-014

Desktop SHALL 在初始化期间显示 Checking browser access，并核验已有浏览器本地会话；已有会话有效时使用真实的会话/CSRF，忽略失效或已使用的启动 ticket，不再次兑换、不清理有效登录。无有效会话时才能兑换本次启动 ticket，并在提交前移除地址栏中的票据；兑换后以实际会话核验结果进入账号登录或 Works。不得持久保存票据、通过复制普通链接携带票据或仅凭成功兑换响应宣称账号已登录。

本地授权缺失、过期、票据失效和 Cookie 无法保留 SHALL 显示 Browser access required；说明本地浏览器尚未获准连接 CLI，提供 Check browser access、Copy reopen command 和当前端口的 `piwork-cli desktop open --port <port> --no-open`。还 SHALL 说明 `piwork-cli desktop logout --port <port>` 可以从同一系统用户的终端清理该实例平台登录。恢复页不指示在已占用端口直接再启动 Desktop。CLI 确认不可达时显示 Desktop connection unavailable、只读重试及启动方向，区别于 Core 不可达。

初始化/手动检查的 GET SHALL 去重，检查结果有归属和确认反馈；初始化失败仍允许显式检查，不能依赖未启动的后台定时器恢复。本地 CSRF 拒绝后 SHALL 先只读核验当前会话：本地会话有效则更新 CSRF 并允许用户明确重新提交，不能自动重发原 mutation；无有效会话才转本地授权恢复。兑换响应丢失时先检查 Cookie/会话，不自动重放 ticket；有效票据兑换后 Cookie 未保存时显示具体恢复说明，不无限重试。

#### Scenario: 旧链接与有效 Cookie 同时存在
- **WHEN** 已授权浏览器再次打开含已使用、过期或上次进程 ticket 的链接
- **THEN** 使用本次进程确认有效的本地会话，正常进入账号登录或 Works，旧 ticket 被移出地址栏，没有 bootstrap 重放

#### Scenario: 延迟打开或另一浏览器重放启动链接
- **WHEN** 无有效 Cookie 的浏览器打开过期或已被另一浏览器使用的启动链接
- **THEN** 显示 Browser access required 和当前端口的重新打开命令，没有失效登录表单，不获得保存的 Core 身份

#### Scenario: CLI 重启或浏览器 Cookie 被清除
- **WHEN** 原授权失效但本地 CLI 已运行，用户执行重新打开命令并使用新链接
- **THEN** 新授权可进入账号登录或已保存会话对应的 Works，无需重启 Core/Work，旧授权仍不可使用

#### Scenario: 检查与兑换响应不确定
- **WHEN** 会话查询暂时失败、兑换响应丢失，或浏览器没有保存 Cookie
- **THEN** 分别提供只读检查、按实际 Cookie 核验或 Cookie 无法保留的说明；不自动重放登录或票据，不虚构授权/登录成功，检查入口仍可用

#### Scenario: CSRF 拒绝与晚到的检查结果
- **WHEN** 平台修改被本地 CSRF 校验拒绝，或旧检查在身份/页面变化后返回
- **THEN** 只读核验可恢复有效会话的提交能力但不重发修改，旧结果不覆盖新身份、草稿或释放新锁

### Requirement: 注销平台身份与重置浏览器访问有明确影响

**Identifier:** DWUI-015

已获本地授权的 Desktop SHALL 分开提供 Sign out 和经影响确认的 Reset browser access。Sign out 清理该实例当前 Core 登录及其内容授权，保留本地控制会话，显示平台注销是否已确认；Reset browser access 结束该实例全部浏览器本地会话、派生 Service/文件/观察访问和本地敏感缓存，但不撤销或删除保存的 Core 会话，随后进入 Browser access required。二者均不得停止 Work、Service 或取消已接受的 Run/Operation。

Reset browser access 的确认 SHALL 明确影响该 Desktop 的所有已授权浏览器，取消无修改。确认成功后清除本地会话 Cookie、内容、草稿和相关临时资源；其他浏览器在受保护请求或会话检查时获知失效，活动内容流至多两秒断开。已经发送的文件修改可能已提交，界面不得声称回滚；已经接受的 Import/Export/Run 保持服务端执行。清理不得删除其他 CLI 新写入的 Core 凭证或 Work 数据。

本地授权已丢失时不提供必然被拒绝的 Sign out/Reset 提交按钮，提供可信终端命令说明；执行实例 logout 后重新授权 SHALL 进入正常账号登录。清理中显示实际等待状态、阻止重复提交，失败/未知分别提供检查或重新打开方向，不自动重发。

实例报告保存凭证清理未完成时 SHALL 区分内存身份已清理与磁盘未清理，显示可执行的实例 logout 命令；新登录或切换被拒绝时保留非敏感输入，不宣称已退出后下次启动会保持退出。

#### Scenario: 正常注销后再次登录
- **WHEN** 已授权用户 Sign out，随后输入另一账号
- **THEN** 原平台身份和内容访问被撤销，本地控制会话仍可登录；旧浏览器内容不能显示为新账号，Work 运行目标不变

#### Scenario: 重置浏览器访问并重新打开
- **WHEN** 用户确认 Reset browser access，随后用新启动链接重新打开
- **THEN** 全部旧浏览器会话和派生连接失效，重新授权仍按 Core 的真实保存会话判断登录状态，不伪装为远端注销

#### Scenario: 未授权时从终端清理登录
- **WHEN** 浏览器本地授权丢失，同一系统用户执行该实例 logout，再执行 open
- **THEN** 可进入可提交的账号登录表单，显示本地清理与远端撤销的分别结果，不要求手工删除配置文件

#### Scenario: 清理并发与敏感内容保留边界
- **WHEN** 清理过程中其他 CLI 保存新凭证，或旧响应在新登录后返回
- **THEN** 新凭证不被条件清理删除，旧内容/反馈不进入新账号；本地暂存清理不删除已接受业务结果或 Work 数据

### Requirement: Work 生命周期以接受目标和确认状态共同呈现

**Identifier:** DWUI-016

Desktop SHALL 在 Work 列表行、Work 身份栏、生命周期状态页和原 Operation 详情中一致区分本次请求提交状态、已接受目标、Core 已确认 observed 状态与观察是否成功。`provisioning` SHALL 显示 Preparing，`starting`、`ready`、`degraded`、`stopping`、`stopped`、`failed` SHALL 分别显示 Starting、Ready、Degraded、Stopping、Stopped、Failed；确认 deleted 的 Work 不再作为可运行条目显示，真实未知值或未确认状态 SHALL 有检查入口而不默认 Ready。

Create/Start/Stop/Retry/Delete 接受后 SHALL 立即提供原 Work/Operation ID 和相应目标，例如 Start accepted 或 Stop accepted；后续 Work 查询缓慢时仍可查看原操作。界面 SHALL 保留最后确认状态并说明目标尚在执行，不把 acceptance 写成 Ready/Stopped/Deleted；进度仅显示已取得的状态和阶段，不生成固定百分比或未取得的执行步骤。细阶段缺失时 SHALL 显示 Starting Work / Stopping Work 等对象动作及执行状态，原始状态、ID、确认时间在详情可查。

列表与面板快捷动作 SHALL 使用同一准入规则：准备/启动中的运行目标允许显式 Stop；停止目标执行中只提供检查而不重复 Stop 或提前 Start；确认停止后可 Start，Export 还需 desired/observed 均 stopped 且无已知冲突。desired=running 的启动/恢复失败可 Retry，desired=stopped 的失败检查原 Stop，不改回运行。提交期间只锁该对象的重复及冲突入口，接受后释放提交锁，继续遵守未知结果保护与 Core 实际准入。

#### Scenario: 默认创建到就绪无需重载
- **WHEN** 用户提交有效名称，Core 接受创建并依次返回 provisioning、starting、ready
- **THEN** 创建表单立即显示提交中，接受后原操作可查；列表和面板分别显示 Preparing、Starting、Ready，无 Unknown 假错误，无需刷新整个页面或重复创建

#### Scenario: 停止接受而实际状态尚为运行
- **WHEN** Stop 返回原 Operation ID，但 Work 查询仍确认 ready 且 desired=stopped
- **THEN** 列表和面板显示 Stop accepted 或 Stopping Work，并说明最后确认状态仍为 Ready；不宣布 Stopped，不提供重复 Stop、Start、Export 或新的运行/文件写入入口，原 Stop 可查

#### Scenario: 准备期间停止
- **WHEN** 创建或 Start 已接受，Work 仍 provisioning/starting，用户确认 Stop
- **THEN** 可按既有 Core 准入提交一次 Stop，显示新的停止目标，保留原创建/启动操作，不能用全程观察锁阻止该合法控制

#### Scenario: 停止完成后再启动
- **WHEN** Stop succeeded 且 Work 查询确认 desired/observed 均 stopped，用户随后显式 Start
- **THEN** 两处状态同步为 Stopped，Start 可用，数据保留提示可读；新 Start 按原 ID 观察，确认 Ready/Degraded 及相关能力后恢复对应交互，不自动 Start Service 或改变其 enabled

#### Scenario: 创建校验拒绝和运行失败
- **WHEN** 创建在接受前被校验拒绝，或已接受创建随后 failed
- **THEN** 前者保留名称和高级输入并显示字段/请求原因，不虚构 Operation；后者保留 Core 已发布的原 Work 和 Operation，可检查或修正后显式 Retry，不要求再次创建

#### Scenario: 停止失败或真实状态未知
- **WHEN** Stop failed、查询未确认停止，或 Work 返回无法识别的状态
- **THEN** 显示安全原因、最后确认事实和只读检查入口，不显示停止成功，不开放 Export，不以 Retry Work 将停止目标改回运行

#### Scenario: 降级与删除
- **WHEN** Work 确认 degraded，或 Delete 接受后 Work 从列表消失但清理未终结
- **THEN** 前者仅按各能力实际准入开放交互；后者保留原 Delete Operation 入口，不因行消失宣称清理成功或提供假撤销

### Requirement: 生命周期观察与对象刷新独立收敛

**Identifier:** DWUI-017

Desktop SHALL 将原 Operation 状态查询、Work 元数据确认及必要的列表同步作为可分别成功或失败的只读步骤。自动观察、Check status、Operation 详情检查和恢复查询 SHALL 使用相同的结果处理规则；进行中的当前身份已知生命周期操作 SHALL 在列表与面板持续取得 Work 状态，而不是只在 Operation 终态后刷新。

Operation 达到 succeeded/failed/superseded 后，Desktop SHALL 继续完成所属 Work 的确认及必要列表同步；后续读取失败 SHALL 保留操作终态，显示 Work status not confirmed 或列表未确认及 Check status，不把读取失败改成操作失败，不丢失同步义务。读恢复成功后 SHALL 同时收敛状态和按钮；不得依赖用户整页刷新。手动查询先发现终态也 SHALL 触发同样同步。确认 deleted 的 Work 可经当前列表和既有对象读取缺失收敛，不把合法移除写成创建失败。

用户清空本地已完成操作历史时，Desktop SHALL 独立保留尚用于 Work/列表同步的原 Operation ID、已确认终态及其接受代次。移除历史展示 SHALL 不使已确认的原操作重新成为未决，不使 Work 永久停在 accepted 或保持错误的能力禁用。同步确认后 SHALL 依据匹配的终态解除对应接受意图并释放协调记录；旧代次的历史清理 SHALL 不解除新的控制目标或未知修改保护。

读取暂时失败 SHALL 有有界只读重试，耗尽后有显式恢复入口；鉴权失败进入既有登录恢复，明确 404/410 停止该 ID 的无限观察并保留可读原因。一个对象查询缓慢 SHALL 不阻止其他对象更新。隐藏页面停止周期读取，返回可见页面时确认当前事实；关闭详情或离开 Work 不取消远端操作，Works 列表仍观察所属已知操作。暂停原 Operation 观察不得取消远端执行或暗中重提请求。

#### Scenario: 列表看到执行中的状态变化
- **WHEN** 用户关闭 Create/Stop 的详情并留在 Works，原 Operation 仍在执行
- **THEN** 对应行持续取得 Work 状态，Preparing/Starting/停止目标及快捷动作可更新，没有只有详情才生效的补偿路径

#### Scenario: 终态确认后 Work 查询暂时失败
- **WHEN** 原 Stop 已查询为 succeeded，而 Work 或列表读回暂时返回网络错误/503
- **THEN** 保留 Stop 的成功事实，Work 显示最后确认状态与未确认提示，继续有界 GET 恢复；恢复成功后更新为确认停止，Stop POST 总数仍为一

#### Scenario: 手动检查先于自动轮询取得终态
- **WHEN** 用户 Check status/检查 Operation 先读到 succeeded，随后自动观察运行
- **THEN** Work 和必要列表同步仍执行，不能因操作已经终态跳过确认，按钮无需整页重载即可更新

#### Scenario: 清空历史后待同步的 Work 自动恢复
- **WHEN** 原 Start 已确认 succeeded，Work 或列表读回暂时失败，用户 Clear local records，随后读取确认 Work 为 Ready 且 desired=running
- **THEN** 历史展示可移除，但原 ID 和终态协调依据保留；Work 和必要列表确认后自动解除该次接受意图，状态及使用入口恢复，不继续显示 Start accepted，不要求重载或重提 Start，原 Start POST 总数仍为一；新的 Stop 意图及未知修改锁不受旧记录清理影响

#### Scenario: 独立失败、慢查询和重试耗尽
- **WHEN** Work A 的 Operation 查询成功但 Work 读取失败，或查询持续超时，Work B 可正常查询
- **THEN** A 的操作与对象确认分别表示；A 的查询仍在途时，资源允许的 B 按两秒活跃观察频率跨多个周期查询并发布最新状态，不等待 A 返回、超时或整轮完成，不能只证明首轮并发读取成功；同 ID 在途不重复派发、元数据最多四并发，A 的自动读取有界停止且 Check status 可继续查询原 ID，没有生命周期 POST 重试

#### Scenario: 隐藏、返回列表和暂停观察
- **WHEN** 用户隐藏页面、重新显示、关闭详情返回列表，或暂停后恢复原 Operation 观察
- **THEN** 可见后从原身份及 ID 确认事实，列表中仍可找回活动操作；暂停/关闭/恢复均没有业务修改或远端取消

#### Scenario: 缺失对象、读取失败与空列表
- **WHEN** 列表读取成功为空、列表读取失败，或原 Delete 操作仍可查而 Work 不再存在
- **THEN** 分别显示真实空态、保留旧列表及读取恢复、或原 Delete 进度；不得以读取失败制造零 Work 或丢失 Delete 身份

### Requirement: 原生命周期操作恢复遵守身份及新旧目标顺序

**Identifier:** DWUI-018

Desktop SHALL 在创建接受、已有 Work 控制接受，以及同 Core/账号页面重载恢复后，将已知生命周期 Operation 与所属 Work 关联，供列表行、Work 面板和详情查询。恢复 SHALL 重新确认原 ID 的类型、对象和状态；多个历史或未决操作存在时提供相应原 ID 入口，不仅凭浏览器记录时间或 UI 文案将某历史结果认定为 Core 当前目标。不提供全局操作发现保证，未取得的当前操作不得虚构。

Work 当前事实 SHALL 以既有 Core 查询为依据；新的已接受目标和更高控制版本取得后，旧 Work/Operation 回应不得回退当前目标、重新开放停止中的交互或覆盖其他 Work/身份/草稿。Start 与 Stop 竞争时各自保留原 ID，旧操作的 succeeded/superseded 不能被投影成新 Stop 的结果。重复 GET 可合并，业务 POST 仍只由显式提交产生。

已知操作 ID 缺失或提交结果未知时 SHALL 继续遵守 DWUI-010、012 的原对象核对及禁止盲目重提规则；历史查询、无关操作查询与单纯隐藏提示不能解除未知修改保护。切换 Core/账号清理旧内容、观察及提示，晚返回不能污染新身份；同身份导航后可从已知操作找回已接受任务，不自动弹回旧详情。

接受响应明确报告本地原 ID 记录未保存时，Desktop SHALL 保留本页已接受事实和可复制原 ID，说明重载后的自动找回无法保证；不能将记录失败写成 Core 未接受或自动重新提交。

#### Scenario: 创建接受后关联原操作
- **WHEN** 创建返回新 Work ID/Operation ID，首次 Work 读取成功或暂时失败
- **THEN** 原 Operation 在当前身份可查询；对象取得后其行内检查和面板详情指向该原 ID，不另建操作或再次创建

#### Scenario: 重载恢复正在停止的 Work
- **WHEN** Stop 已接受且仍执行，用户重载 Desktop
- **THEN** 通过当前 Core/账号已知记录查询原 Stop 并关联所属 Work，显示最后确认事实与停止目标，Stop POST 不增加，其他账号记录不进入页面

#### Scenario: 多个历史操作和类型差异
- **WHEN** 同一 Work 有 Create、Start、Stop 的历史记录，包含接受时的英文名称和 Core 的规范操作类型
- **THEN** 正确识别生命周期动作并可查询各原 ID，当前目标来自确认事实，记录顺序或旧成功不能直接授予 Start/Export 或覆盖当前停止

#### Scenario: Stop 取代 Start 且旧读回晚到
- **WHEN** Start 已接受，随后 Stop 已接受，旧启动查询或旧 Work 快照在新停止目标/版本之后返回
- **THEN** 页面保持停止目标和对应按钮，保留两个 Operation，旧结果仅更新旧操作详情，不能重新显示当前已就绪或恢复运行交互

#### Scenario: 切换对象或身份后返回旧结果
- **WHEN** 用户切换 Work/Core/账号，旧观察或提交随后返回
- **THEN** 旧结果不打开旧弹层或覆盖新内容/草稿/锁；同身份已接受 ID 仍可在其原对象找回，新身份不能读取旧记录

#### Scenario: 未知提交与无关查询
- **WHEN** 生命周期请求结果丢失且无原 Operation ID，用户查询另一个 Work 或同 Work 的无关历史操作
- **THEN** 原未知结果保护仍存在，界面只提供匹配原对象的核对方向，不因成功读取或提示消失允许盲目重复提交

#### Scenario: 接受后本地记录保存失败
- **WHEN** Core 已接受创建或控制并返回原 ID，但 CLI 明确报告 localRecordSaved=false
- **THEN** 当前页面仍可观察并复制原 ID，说明重载自动恢复的限制；不声称操作失败，不发第二次创建或控制请求

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。用户显式 Refresh/Check 且结果未变化时 SHALL 在当前上下文给一次简短确认；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

#### Scenario: 多目录正常读取后不堆积
- **WHEN** 用户在同一 Work 依次打开根目录、apps、子目录，再返回根目录并切换 Services/Chat
- **THEN** 等待有局部读取反馈，完成后内容正常展示，没有 Checked/Confirmed 加 ISO 时间的状态条，没有跨目录成功记录堆积或背景读取 toast

#### Scenario: 手动检查未变化
- **WHEN** 用户显式刷新目录或检查 Work，成功结果与已有内容相同
- **THEN** 当前模块出现一次简短确认，三秒内消失且不重复累积；失败时有可操作错误而非成功措辞

#### Scenario: 写入成功、未知结果及读回失败
- **WHEN** Save 已确认、修改响应丢失，或原操作已确认而对象刷新失败
- **THEN** 分别提供简短保存确认、持续的未知核对入口、或确认结果与刷新未确认说明；短提示到期不改变提交保护或重放任何修改

#### Scenario: 详情关闭与应用稳定
- **WHEN** 进行中的生命周期详情关闭、反馈到期，或状态刷新时当前 Service 有未保存输入
- **THEN** 原 Operation 从所属 Work/已知操作仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用

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
