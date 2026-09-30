# Spec Delta

## Purpose

使 Work 所有者通过 CLI 启动的本地浏览器界面完成工具使用、Agent 对话、共享文件和 Work 维护，落实统一产品语言，并为认证、长任务、大文件传输及失败恢复建立可测试的运行契约。

## ADDED Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除本地授权、关闭相关内容流并进入登录恢复页面；普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销本地访问并说明未确认远端撤销，禁止显示远端撤销成功。

#### Scenario: Core 可达但运行环境失败
- **WHEN** 健康接口正常而运行依赖不可用
- **THEN** 登录和可用控制信息仍可使用，创建/启动显示真实限制，不把连接状态写成全部 Ready

#### Scenario: 过期后重新登录
- **WHEN** 用户在观察已接受的 Import 时会话过期，随后重新登录同一账号
- **THEN** 内容访问中止后恢复原 Operation 查询，Import 不被再次提交

#### Scenario: 切换 Core 或用户
- **WHEN** 用户从 Core A/用户 A 切换到 Core B 或用户 B
- **THEN** A 的 token、文件内容、对话和活动不被发送给或展示为 B 的内容

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

#### Scenario: 忙碌时保留输入
- **WHEN** 同一 Work 的另一 Session 正在执行而当前 Session 发送失败为 busy
- **THEN** 显示活动执行入口并保留草稿，不排队、不取消旧 Run

#### Scenario: 断线与游标过期
- **WHEN** 事件观察断开，恢复请求报告游标过期
- **THEN** 从原 Run 结果和 Session 历史恢复，只呈现一次已有输出，不发第二次消息

#### Scenario: 取消与成功竞争
- **WHEN** 用户取消时 Core 已经成功完成 Run
- **THEN** 最终显示 succeeded，不能以本地取消请求覆盖真实结果

### Requirement: Service 管理与数据上下文清楚分离

**Identifier:** DWUI-005

Desktop SHALL 实现 DUL-004、006、013：Service 列表/详情包含禁用、失败、非 Web 服务，提供公开域名/端口、Start/Stop/Restart/Retry/Remove 和有界日志刷新，访问行为遵循 `browser-service-access`。Stop 是持久禁用，Start 不启动停止的 Work，Remove 保留共享文件且无法以 Start 撤销。日志 SHALL 显示取得时间、截断及不可用原因，不伪装实时终端。无效动作说明原因，控制完成以原 Operation 为准。

所选 Service SHALL 只提供明确的身份上下文，不自动读取或上传页面 DOM、输入、截图和内存。用户请求分析时 SHALL 通过 Agent 的实际文件/API 能力取得数据，并要求回答说明来源；无来源时说明不可访问，不声称浏览器已同步数据。现有 Service 创建/定义更新仍由 Agent 工作流完成。

#### Scenario: 非 Web 和禁用 Service
- **WHEN** 服务没有可用 Web 端口或被禁用
- **THEN** 仍可查看详情/日志和有效控制动作，不能因为不可预览就隐藏服务

#### Scenario: 移除后文件仍保留
- **WHEN** 用户确认 Remove Service 并观察到成功
- **THEN** 服务消失但共享 workspace 不被 UI 描述为已删除，恢复定义仍需 Agent 操作

#### Scenario: 请求分析 Service 数据
- **WHEN** 用户操作应用后在聊天中请求分析
- **THEN** 明确传递 Service 身份而非页面内容，实际读取文件/API 后说明来源，数据不可达时不编造结果

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

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS/Advanced 内容
- **THEN** 原 Operation 只激活其已接受候选，新编辑仍 Not applied

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
