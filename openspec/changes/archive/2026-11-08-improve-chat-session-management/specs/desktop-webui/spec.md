## MODIFIED Requirements

### Requirement: Session 与 Run 的观察可恢复且不重复提交

**Identifier:** DWUI-004

Desktop SHALL 提供 Session 创建、列表、读取与切换，提交消息、文本/工具事件、Run 详情和显式取消，落实 DUL-012。标题优先使用已确认持久标题；旧 Agent 或无持久标题时使用已加载首消息摘要；没有摘要时按当前列表位置显示 Session 1、Session 2 等编号。一个 Work 活跃 Run 的限制 SHALL 在其他 Session 提交前后都明确反馈，保留草稿且不建立隐藏队列。取消以当前 Run ID 为目标，取消中不预告终态。

断线恢复 SHALL 按原 Run ID 和事件游标查询/观察，重复事件去重；游标过期 SHALL 查询结果和 Session 历史，不重发 prompt。旧 context 不兼容 SHALL 提供 New session 并保留草稿，不自动迁移。停止 Work 不新取历史，页面已有内容标为旧内容。所有观察 SHALL 在切换身份、对象或页面卸载时释放本地连接，不取消远端执行。

手动 Run 与由显式 Service 请求受理的自动 Run SHALL 共用真实 Session/Run 历史和观察能力。自动处理记录与已经受理的 Run SHALL 分开表达：待处理或等待状态不等于正在执行模型；自动请求不是手动消息的隐藏队列。每个 Run SHALL 展示实际模型及执行来源，Service 来源 SHALL 能定位请求、已核验的事件/证据和当前阶段。关闭观察不取消请求；Cancel run 取消当前 Run，若关联未完成请求则同时结束其后续自动续接；Cancel request 可直接取消待处理、执行中或等待中的请求。

当前用户 Chat 的输入区 SHALL 将独立 Cancel run 与新消息发送分成可辨的两个动作。已确认的可取消活动 Run SHALL 有不依赖非空草稿、模型选择或新消息有效性的独立停止入口；仅取消目标 Run，不提交新消息或消费草稿。当前用户 Chat 的模型发送 SHALL 根据本 Work 的真实活跃 Run 与独立能力确认，在原 Send 位置显示 Stop and send；目标快照绑定原 Core/账号、Work、Session、旧 Run、输入内容和原 submissionKey。用户点击或在该动作明确可见时按 Enter 才执行 CONV-CANCEL-SEND-001；空输入、未确认模型设置、非法图片或失效资源命令不得取消旧 Run。Shift+Enter、输入法组合和五个网页 slash 动作保持原行为；仅导航或编辑不请求取消。

Stop and send SHALL 可以取消同 Work 的任意来源旧 Run，取消与新提交由服务端协调，确认旧执行结束后才接受新 Run；不能把按钮操作拆成可能被后台抢槽的独立隐式发送。旧 Run 已终态且没有另一个活跃 Run时正常提交；出现新的不同活跃 Run 时保留输入并重新确认目标，不扩展取消授权。取消等待最多 5 秒；超时、明确拒绝或新受理前失败保留文字、图片和设置，超时后不得因旧 Run 稍后结束而自动发送。提交接受响应未知时保留原键并按 CONV-SUBMISSION-001 只读核对。

当前 Work 活跃 Run 的读取 SHALL 不切换当前 Session 或加载其他 Session 全部历史；支持能力未确认、Work 不可达或读取失败不得当作已确认空闲。未支持组合动作的旧 Agent SHALL 保留已有 Cancel run、普通 Send 和 busy 提示。已受理 Run 的执行与观察断线规则不变。

Chat 正文 SHALL 移除 Run History ID 列表，原 Session/Run 数据及实际模型、Thinking、来源仍在按需 Run 详情可读。历史详情 SHALL 绑定明确的原 Run，不覆盖当前活跃 Run 的观察对象，不取消或提交执行；错误、进行中与未知提交恢复仍在所属上下文可见。正常成功与已受理回执 SHALL 不再以常驻 Run 状态行或 Message accepted 卡片重复占用正文和输入区；失败、中断、部分输出及观察未确认的事实与恢复入口 SHALL 留在原轮次。

全 Work 活跃 Run 的投影 SHALL 只决定忙碌说明及明确的停止目标，不取代当前 Session 原 Run 的错误和观察恢复投影。当前 Chat 原错误、失败及未知反馈 SHALL 在其他来源占槽时继续可见；打开原 Run 详情或核对原状态 SHALL 不覆盖活动槽的观察对象、不改绑停止目标，也不提交执行。旧消息缺少可确认关联时保留原未知表达，不猜测另一个 Run 属于当前用户消息。

事件入口返回 410 后，Desktop SHALL 真正读取原 Run 和对应 Session；只有历史读取成功后才能提示历史已恢复。SHALL 停止向事件入口重发同一失效游标，不擅自用 0 重播。原 Run 仍活跃时 SHALL 展示历史恢复模式，以串行只读查询观察原 Run 和已保存历史；查询到终态后 SHALL 停止自动观察并呈现最终结果，已有输出不得重复追加。读取失败 SHALL 保留已知内容、Run ID 和可恢复提示；鉴权失效或对象不存在 SHALL 停止自动读取并进入对应恢复状态，不能发送新的 Run。

当前身份各 Work/Session 中未发送的非空文字或图片草稿 SHALL 纳入页面刷新、关闭和离开的未保存保护；浏览器支持且满足提示条件时请求原生离页确认，取消离开保留原草稿。不自动发送、上传或新建 Session，不承诺浏览器强制关闭、崩溃或不支持离页提示时能恢复。首版不新增跨关页草稿持久化；账号/Core 切换、注销和本地授权失效仍清理旧身份草稿及图片预览资源。可靠受理只消费本次提交快照，后续新编辑仍受保护。

Run详情入口 SHALL 绑定实际Work/runId及Session上下文，并跟随对应一轮消息/Activity或明确活动执行状态；没有runId的历史消息不推测绑定当前最近Run，同一Run不因多段消息重复展示详情。全Work业务请求与Session对话、单次Run SHALL 分层，Request与Run各自显示真实状态；等待请求可没有活跃Run，某次Run成功不能推导目标完成。请求列表/详情展示调整 SHALL 保持分页、原过滤、取消竞争、historical只读及Retry新请求语义。

Assistant消息正文 SHALL 支持GFM标题、强调、列表、链接、代码块及表格，历史与流式增量采用同一renderer；用户文字与工具输出保持原义。原始HTML不得执行，危险/相对链接不得导航本地授权页面，外链隔离opener，Markdown图片不自动读取外部资源。超出解析预算或解析失败时 SHALL 保留完整转义文字；表格和代码在消息内横向滚动，不撑开Chat或覆盖输入区。现有source入口、鉴权图片、Session/Run身份与阅读位置规则保持。

#### Scenario: 历史与新回复含表格或代码
- **WHEN** 打开已有assistant历史或接收增量Markdown表格、未闭合代码围栏
- **THEN** 正文安全解析或完整转义回退，表格/代码可局部滚动，危险HTML与URL不执行，用户/工具文字及原附件入口不改变

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

#### Scenario: 当前 Work 的其他 Session 或 Service 占槽
- **WHEN** 当前用户 Session 有可发送草稿，真实活跃 Run 来自另一 Session 或 Service，且能力已确认
- **THEN** Send 位置提供 Stop and send 并明确旧执行来源，用户确认后在原用户 Session 接受一个新 Run，最多一个执行占槽，用户会话与草稿不被后台对话替换

#### Scenario: 无效新消息不影响旧执行
- **WHEN** 用户尝试用空输入、非法图片、未知命令或未确认模型执行 Stop and send
- **THEN** 保留内容并说明校验原因，旧 Run 不收到取消，没有新 Run

#### Scenario: 取消等待超时且旧 Run 随后结束
- **WHEN** 旧执行在取消请求后 5 秒仍未收尾，并在界面已收到超时后才结束
- **THEN** 显示取消等待超时与原状态核对，草稿保留，没有新消息自动提交，旧执行槽在实际停止前继续保留

#### Scenario: 目标变化和完成竞争
- **WHEN** 原目标 Run 先完成，或它完成后新的不同 Run 已占槽
- **THEN** 前者保留原结果并正常发送；后者保留草稿并更新忙碌目标，不取消新 Run、不自动发送

#### Scenario: 接受响应丢失与后续编辑
- **WHEN** Stop and send 的新 Run 已受理但响应丢失，或用户在等待期间继续编辑下一条内容
- **THEN** 按原 submissionKey 查询同一 Run且不重发，确认只消费已提交快照，后来的文字、图片和模型选择保持

#### Scenario: 原能力降级与历史详情
- **WHEN** Agent 未声明组合动作能力，或用户查看已完成 Run 的执行信息
- **THEN** 前者保留普通聊天与显式 Cancel run，不静默升级镜像；后者不显示正文 ID 列表，详情仍可读实际设置、来源和诊断，不替换当前执行观察对象

#### Scenario: 后台活动与当前 Chat 错误并存
- **WHEN** 当前 Session 有已确认失败或观察中断的原 Run，另一 Session 或 Service 随后占用活动槽
- **THEN** 原错误与按原 Run 核对的入口继续可见，忙碌来源及 Stop and send 指向另一个真实活跃 Run，草稿、Session 和原观察关联保持

#### Scenario: 410 后原 Run 已完成
- **WHEN** 事件入口返回 410，原 Run 查询确认 succeeded 且 Session 保存了最终回答
- **THEN** 实际读取 Session 并展示最终回答一次，停止自动读取，不重复 POST prompt 或请求失效事件游标

#### Scenario: 410 后原 Run 仍运行
- **WHEN** 事件入口返回 410，原 Run 先返回 running 后进入终态
- **THEN** 通过同一 Run 的只读状态和 Session 历史查询看到运行中及终态，事件入口不收到同一失效游标的无限重试，终态后查询停止

#### Scenario: 历史恢复失败或身份切换
- **WHEN** Session 读取失败、鉴权失效，或用户在历史恢复期间切换身份
- **THEN** 不显示虚假的恢复成功；读取失败保留已知内容和恢复入口，身份失效后停止旧观察且旧响应不写入新身份

#### Scenario: 文字或图片草稿触发离页保护
- **WHEN** 用户交互后在任一 Session 保留未发送文字或合法图片并尝试刷新页面
- **THEN** 支持的浏览器请求离页确认；取消后文本、图片和归属保持，没有 Run 或上传；只有全部草稿已消费/明确丢弃时不因聊天草稿阻止离开

#### Scenario: 旧身份草稿不会被离页保护保留到新身份
- **WHEN** 用户注销、切换账号/Core 或本地授权失效
- **THEN** 按原安全规则清理文字、图片和预览资源，不因离页保护留下可被新身份读取的内容

#### Scenario: 当前对话和其他来源的执行详情不混淆
- **WHEN** 用户查看当前Session历史Run，同时Work由其他Session/Service运行或存在等待请求
- **THEN** 各入口只打开精确原Run/Request，来源可辨，旧消息不绑定最新执行；关闭查看不停止Run或恢复等待目标

#### Scenario: 多次执行的请求仍以目标状态为准
- **WHEN** 请求关联多个Run，其中某次succeeded但目标waiting_result/waiting_apply/needs_attention
- **THEN** 原请求状态与必要下一步直接可见，执行、回复与证据按真实关联呈现，不虚构整体完成或重放mutation

#### Scenario: 无新草稿仍可停止
- **WHEN** 本 Work 有已确认可取消活动 Run，用户输入为空或新消息的模型／图片尚不满足发送条件
- **THEN** 独立停止仍可显式取消该原 Run；无 Run 提交，文字、图片和设置草稿保持，不能把模型发送限制错误地当成停止限制

#### Scenario: 独立停止和组合发送分别执行
- **WHEN** 用户有新草稿并分别选择独立停止或 Stop and send
- **THEN** 前者只发送原 Run 的取消请求；后者经过原新消息校验，按 CONV-CANCEL-SEND-001 一次提交协调取消与受理，不拆成客户端先取消再普通发送

## ADDED Requirements

### Requirement: Session 创建与管理状态可恢复

**Identifier:** DWUI-SESSION-MANAGE-001

Desktop SHALL 在创建或原提交核对确认后读取该 Session 的有界历史；可靠空历史 SHALL 展示可输入的空会话，读取失败 SHALL 保留已创建身份并提供只读重试。创建结果未知 SHALL 使用原提交键核对，不自动再次创建。切换身份、Work 或用户明确选择其他 Session 后，迟到响应 SHALL NOT 抢占选择或消费其他草稿。

Desktop SHALL 在当前 Work 会话列表标题右侧提供紧凑 New，在每行提供独立 Rename、Auto name、Delete；Rename 手动名称的优先级及自动命名行为遵循 CONV-SESSION-TITLE-001。删除 SHALL 先说明逻辑移除与历史、证据、文件和 Memory 保留范围并请求确认；目标活跃时禁用并说明需停止或等待，服务端仍须核验。取消不提交；未知结果先核对。删除当前会话后的新建遵循 DWUI-SESSION-REPLACEMENT-001。

#### Scenario: 新建空会话
- **WHEN** New Session 已确认创建且空历史读取成功
- **THEN** 骨架退出，显示可输入的空会话，且只创建一次

#### Scenario: 创建成功但历史读取失败
- **WHEN** 新 Session 已创建而历史读取失败
- **THEN** 显示原 Session 与读取失败及重试入口，重试只读取，不再次创建

#### Scenario: 修改和删除会话
- **WHEN** 用户在非当前行操作 Rename 或确认 Delete
- **THEN** 操作绑定该行而非当前 Session，成功或取消后能在列表内核对正确目标

#### Scenario: 迟到结果与用户选择
- **WHEN** 新建或读取仍在进行时用户切换其他 Session
- **THEN** 迟到响应不得抢回选择或清空目标草稿

### Requirement: 删除当前 Session 后创建新 Session

**Identifier:** DWUI-SESSION-REPLACEMENT-001

确认删除当前会话后，Desktop SHALL 发起一次独立的新 Session 创建并选择其可靠受理结果，不切换到已有会话，且不受消息提交状态阻塞；删除非当前会话不创建新 Session。新建失败 SHALL 保留已确认删除及空上下文并提供显式重试；创建结果未知 SHALL 使用原提交键只读核对，不盲目再次创建。删除或创建期间用户切换身份、Work 或会话后，迟到结果 SHALL NOT 抢占新的选择。

#### Scenario: 删除当前会话后新建会话
- **WHEN** 用户确认删除当前 Session，且删除可靠成功
- **THEN** 发起一次新 Session 创建，受理后选择新会话并读取其空历史，不切换到现有会话

#### Scenario: 删除后创建失败或结果未知
- **WHEN** 删除已确认，但新建失败或结果未知
- **THEN** 保留删除成功事实，不选择其他已有会话；明确失败可显式重试，未知结果按原创建键只读核对

#### Scenario: 删除非当前会话或创建期间切换
- **WHEN** 删除非当前会话，或删除后创建期间用户选择其他会话、Work 或身份
- **THEN** 前者不创建新会话；后者的迟到结果不得覆盖用户的新选择

#### Scenario: Session 创建与消息提交各自恢复
- **WHEN** 用户新建 Session，或删除当前会话后创建替换会话
- **THEN** Session 创建有独立的原键和状态，不覆盖消息提交；仅本次创建失败或结果未知时展示其重试或核对入口
