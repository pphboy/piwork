# Spec Delta

## MODIFIED Requirements

### Requirement: Session 与 Run 的观察可恢复且不重复提交

**Identifier:** DWUI-004

Desktop SHALL 提供 Session 创建、列表、读取与切换，提交消息、文本/工具事件、Run 详情和显式取消，落实 DUL-012。标题使用真实首消息摘要或创建时间/ID。一个 Work 活跃 Run 的限制 SHALL 在其他 Session 提交前后都明确反馈，保留草稿且不建立隐藏队列。取消以当前 Run ID 为目标，取消中不预告终态。

断线恢复 SHALL 按原 Run ID 和事件游标查询/观察，重复事件去重；游标过期 SHALL 查询结果和 Session 历史，不重发 prompt。旧 context 不兼容 SHALL 提供 New session 并保留草稿，不自动迁移。停止 Work 不新取历史，页面已有内容标为旧内容。所有观察 SHALL 在切换身份、对象或页面卸载时释放本地连接，不取消远端执行。

手动 Run 与由显式 Service 请求受理的自动 Run SHALL 共用真实 Session/Run 历史和观察能力。自动处理记录与已经受理的 Run SHALL 分开表达：待处理或等待状态不等于正在执行模型；自动请求不是手动消息的隐藏队列。每个 Run SHALL 展示实际模型及执行来源，Service 来源 SHALL 能定位请求、已核验的事件/证据和当前阶段。关闭观察不取消请求；Cancel run 取消当前 Run，若关联未完成请求则同时结束其后续自动续接；Cancel request 可直接取消待处理、执行中或等待中的请求。

当前用户 Chat 的模型发送 SHALL 根据本 Work 的真实活跃 Run 与独立能力确认，在原 Send 位置显示 Stop and send；目标快照绑定原 Core/账号、Work、Session、旧 Run、输入内容和原 submissionKey。用户点击或在该动作明确可见时按 Enter 才执行 CONV-CANCEL-SEND-001；空输入、未确认模型设置、非法图片或失效资源命令不得取消旧 Run。Shift+Enter、输入法组合和五个网页 slash 动作保持原行为；仅导航或编辑不请求取消。

Stop and send SHALL 可以取消同 Work 的任意来源旧 Run，取消与新提交由服务端协调，确认旧执行结束后才接受新 Run；不能把按钮操作拆成可能被后台抢槽的独立隐式发送。旧 Run 已终态且没有另一个活跃 Run时正常提交；出现新的不同活跃 Run 时保留输入并重新确认目标，不扩展取消授权。取消等待最多 5 秒；超时、明确拒绝或新受理前失败保留文字、图片和设置，超时后不得因旧 Run 稍后结束而自动发送。提交接受响应未知时保留原键并按 CONV-SUBMISSION-001 只读核对。

当前 Work 活跃 Run 的读取 SHALL 不切换当前 Session 或加载其他 Session 全部历史；支持能力未确认、Work 不可达或读取失败不得当作已确认空闲。未支持组合动作的旧 Agent SHALL 保留已有 Cancel run、普通 Send 和 busy 提示。已受理 Run 的执行与观察断线规则不变。

Chat 正文 SHALL 移除 Run History ID 列表，原 Session/Run 数据及实际模型、Thinking、来源仍在按需 Run 详情可读。历史详情 SHALL 绑定明确的原 Run，不覆盖当前活跃 Run 的观察对象，不取消或提交执行；错误、进行中与未知提交恢复仍在所属上下文可见。

全 Work 活跃 Run 的投影 SHALL 只决定忙碌说明及明确的停止目标，不取代当前 Session 原 Run 的错误和观察恢复投影。当前 Chat 原错误、失败及未知反馈 SHALL 在其他来源占槽时继续可见；打开原 Run 详情或核对原状态 SHALL 不覆盖活动槽的观察对象、不改绑停止目标，也不提交执行。旧消息缺少可确认关联时保留原未知表达，不猜测另一个 Run 属于当前用户消息。

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

### Requirement: Service 处理记录与证据在现有工作区闭环

**Identifier:** DWUI-FEEDBACK-001

Desktop SHALL 在 Chat 及对象详情中提供当前 Work 的处理记录列表与详情，可按 Service 范围分页查看真实请求、来源事件、关联 Runs、等待对象、终态、错误和证据；证据 SHALL 表达观测时间、状态/代码版本及验证结论。分页 SHALL 使用服务端有界查询和游标，不在浏览器加载全部历史。自动 Session SHALL 可以进入现有 Session/Run 观察，不新增顶层工作流导航或独立执行控制台。

Cancel request 和 Retry request SHALL 是明确且作用域可辨的操作。取消 SHALL 阻止后续自动 Run；重试 SHALL 使用稳定的新 submissionKey 生成关联原请求的新请求，而不是复用未知结果的 Action。响应丢失 SHALL 查询原请求/提交结果，不自动生成第二次重试。导入的 historical 请求 SHALL 展示历史标记并禁用直接 Retry；用户可另行明确提出新的目标。Stop/Apply/Delete 准入失败 SHALL 显示真实原因，不暗中 Start、Apply 或取消其他 Run。

该工作区 SHALL 延续 master 的本地反馈、对象级锁、关闭只停止观察、跨身份清除及已受理 ID 恢复规则；页面状态刷新 SHALL 不重载 Service iframe。处理记录是领域记录，SHALL 不混入通用 UI 读取成功流水；请求状态未知 SHALL 显示最近确认值与 Check status，不能猜测成功或失败。

Desktop SHALL 以当前 Work/Service 的有界请求查询确认是否存在记录。在现有 Service 工具栏右侧、Focus 与独立打开动作之前，仅当已确认有记录时显示英文 Agent requests 按钮；确认空集合时隐藏，已完成、已取消和 historical 记录仍使入口保留。初次未确认时不新增空态占位，读取失败不能清除此前已确认存在的入口或被当作空集合。当前 Service 可见且 Work 可查询时 SHALL 自动进行有界、去重的只读刷新，使原本无记录时后来收到的请求能在下一次正常刷新后出现；页面隐藏、身份变化或离开该 Service时停止其周期查询。

新增 Service 入口 SHALL 复用现有请求列表与详情，初始范围为原 Work 与当前 Service；切换网页端口不改变请求范围。列表展示请求内容摘要、来源、时间、真实状态及查看/取消；详情展示原请求、可取得的关联 Run 回复、请求结果与错误，证据和技术身份按需读取。无回复、读取失败、业务请求未完成与某次 Run 已结束 SHALL 分开表达，不拿其他请求的回复或某个 Run succeeded 填充请求完成。关联回复仅从原请求确有关系的 Run 取得，不因自动 Session 共用而展示整个 Session 的无关内容。

Service 入口的新增操作 SHALL 限于查看和取消，不增加补充对话或输入框；原 Chat 全 Work 入口和既有显式 Retry 能力保持原位置与语义，不在新入口增加重试流程。pending 或等待中的 live 请求可直接取消，执行中显示 cancelling 直到真实 Run 收尾；取消后不得再自动续接。终态完成先提交时返回原结果，historical 只读。取消 Agent 处理不撤销已经提交的业务 Job 或数据。

列表/详情的查看、分页、状态刷新与关闭 SHALL 不修改用户 Session 选择，不重载同一 Service iframe，不启动 Run。关闭详情返回原请求列表及其过滤、阅读位置，关闭列表返回发起入口并恢复焦点；Work/Core/账号切换使旧响应失效。读取或取消未确认 SHALL 沿既有错误与原请求 Check status 恢复，不自动重发消息或新建请求。

同一身份、Work 和原请求范围内，关联 Run 读取失败 SHALL 保留该 Run 最后确认的回复、实际模型与 Thinking，并显示读取错误及最后成功读取时间；首次未取得回复、已取得后刷新失败及其他 Run 成功刷新 SHALL 分别表达。部分失败不得清空其他已确认回复，不得使用其他请求缓存填充内容；关联仅以该原请求当前确认的 runIds 为准。

原 Chat 显式 Retry 的接受响应未知时，Desktop SHALL 保留原 Work、原 requestId、原 submissionKey 和对应未知操作锁，并通过纯读取核对该次 Retry 的受理结果。确认受理时 SHALL 验证新请求属于该 Work 且 retryOf 指向原请求，展示该已受理新请求并仅解除匹配的未知锁；读取旧请求本身或另一个新请求不得视为该次 Retry 已确认。同一身份内未找到映射、读取失败或旧组件不支持时 SHALL 保留未知表达、原键和匹配锁，不自动重发 Retry、不新建键、不解除其他操作锁。身份改变 SHALL 使旧响应失效，不把旧意图或内容迁移到新身份，不以旧结果解除新身份的锁。只读核对不得唤醒处理、创建请求/Run 或隐式 Start/Apply；Service 新入口仍不增加 Retry 动作。

用户在列表取消后，Desktop SHALL 在列表或对应详情可见且 Work 可查询时，对该原记录立即及正常每五秒进行有界、去重的只读收尾核对，并将最新确认状态合并回原分页缓存。确认终态后结束该记录的收尾观察；读取失败保留最后确认状态和错误恢复入口，不将取消请求显示为已取消。隐藏页面、离开该 Work 或关闭列表/详情 SHALL 停止本地收尾观察，重新打开时核对原记录，不重发取消；完成先提交时保留真实完成结果。

证据分页响应 SHALL 仅合并对应请求的证据项和分页游标，使用响应返回时该原请求的当前缓存，不以发起分页时的旧详情替换缓存。分页附带的旧请求投影 SHALL 不回写最新确认的 state、updatedAt、runIds、result、error、状态确认时间或读取错误，不据此过滤已确认回复或修改取消收尾观察标记。已确认终态 SHALL 不因晚分页回退为非终态；详情和列表继续保持同一最新确认投影，不通过重新启动收尾观察补救旧状态回写。

#### Scenario: 查看一次异步处理的闭环
- **WHEN** Service 请求从受理、Action、等待 Job、验证到完成
- **THEN** 详情关联来源事件、真实 Run/Action/Job 与结果证据，等待期间可继续手动聊天，终态能追溯验证依据

#### Scenario: 重试响应丢失
- **WHEN** 用户显式 Retry request 后失去响应
- **THEN** 保留原请求、本次 submissionKey 与对应未知锁，只读核对该键；确认后定位已受理且 retryOf 匹配的新请求，只解除匹配锁，不重发 Retry 或自动生成第二个请求

#### Scenario: 导入历史不参与自动处理
- **WHEN** 用户打开导入 Work 的来源请求与证据
- **THEN** 能完整阅读历史，直接重试不可用，Work 启动不会因此产生自动 Run

#### Scenario: 空 Service 后收到首个请求
- **WHEN** Service 请求查询已确认空集合，随后该 Service 向 Agentd 成功投递首个请求
- **THEN** 初始工具栏无按钮和占位，下一次正常只读刷新后出现 Agent requests；没有统计条、状态卡、额外页面或自动弹窗

#### Scenario: 只有终态或导入历史
- **WHEN** 当前 Service 的记录全部已完成、已取消或 historical
- **THEN** 按钮保留，用户可查看原结果；终态及 historical 不提供取消，historical 不进入自动执行

#### Scenario: Service 范围和晚响应
- **WHEN** 用户从 Service A 打开请求记录，换端口或切换为 Service B，A 的旧读取随后返回
- **THEN** A 的端口变化不产生另一份请求范围；B 的入口和记录只使用 B 的读取，旧响应不覆盖 B 或新的用户身份

#### Scenario: 请求回复和 Main Chat 保持独立
- **WHEN** 用户打开多个自动请求之一的详情，自动 Session 同时保存其他请求的历史
- **THEN** 只显示该请求可确认关联的回复与结果，Main Chat 的 Session、草稿及阅读位置不变，同一 iframe 不增加文档加载，没有新模型提交

#### Scenario: 取消等待或正在处理的请求
- **WHEN** 用户从新 Service 入口取消一个 pending、waiting_result 或 running 的 live 请求
- **THEN** 无活跃执行时取消原请求；执行中先显示 cancelling，确认停止后显示 cancelled并阻止续接；原业务 Job 和已提交结果仍按自己的真实状态显示

#### Scenario: 取消回执或查询失败
- **WHEN** 已有记录的刷新失败，或取消返回结果未确认
- **THEN** 原入口、请求身份和最后确认内容保留，现有错误与 Check status 可用，不把失败显示为无记录或已取消

#### Scenario: 只读详情关闭与专注布局
- **WHEN** 用户在 Service + Chat、仅 Service 或 360px 布局中查看、取消并关闭详情
- **THEN** Agent requests 和退出动作可达，返回原列表或发起入口且焦点可恢复，Service iframe和用户 Chat节点不被重建

#### Scenario: 已确认回复的重新读取失败
- **WHEN** 原请求已有可见回复和实际执行信息，重新读取对应 Run 返回错误
- **THEN** 保留最后确认内容并标明读取失败和最后确认时间，不改成未取得回复，不加载其他 Session 全部历史

#### Scenario: 多个关联 Run 部分读取失败
- **WHEN** 同一请求的多个已确认关联 Run 中，一部分刷新成功而另一部分刷新失败
- **THEN** 成功部分更新，失败部分保留各自最后确认内容并说明错误，不相互覆盖且不串入其他请求回复

#### Scenario: Retry 核对尚未确认或旧组件不支持
- **WHEN** 原 Retry 回执未知，按原键查询未找到映射、失败或报告不支持
- **THEN** 保留原键、未知结果和匹配锁，可继续只读核对，不把未找到视为失败，不发送 Retry POST 或自动更新镜像

#### Scenario: Retry 核对范围失配或晚响应
- **WHEN** 核对结果的 Work、原请求或提交键不匹配，或用户已切换身份/Work
- **THEN** 不采用该结果、不解除当前或其他操作锁，不展示另一作用域内容、不触发新的执行

#### Scenario: 列表取消跟踪真实终态
- **WHEN** 用户在列表取消 running 请求，收到 cancelling 后原执行实际收尾
- **THEN** 可见列表在下一次正常只读核对后更新为原真实终态，取消动作随终态禁用，分页、过滤、阅读位置、Main Chat 和同一 iframe 保持

#### Scenario: 关闭列表停止收尾观察
- **WHEN** 列表取消中的原请求尚未收尾，用户关闭列表或隐藏页面后再打开
- **THEN** 离开时停止本地周期读取而不撤销远端取消，重新打开只读核对原记录，不重发 Cancel 或新建请求

#### Scenario: 证据分页与取消终态核对并发
- **WHEN** More evidence 已读取 cancelling 的旧请求快照但响应延迟，原 ID 状态读取先确认 cancelled 并结束收尾观察，然后旧分页响应返回
- **THEN** 只将该页证据和游标合并到当前缓存，详情及各列表缓存保持 cancelled、最新结果、错误和 runIds，取消观察标记不被旧页改变；返回列表并经过正常刷新周期仍保持终态，只有一次 Cancel 且没有新 Run
