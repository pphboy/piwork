# Spec Delta

## MODIFIED Requirements

### Requirement: 以统一语言组织可操作的 Work 工作区

**Identifier:** DWUI-002

Desktop SHALL 落实 DUL-001—007、DUL-010、DUL-016 的对象、容器、英文文案和 Serve 浅色视觉规则。Work List SHALL 独立展示搜索、New Work、Import、账号、按 ID 查询操作与对齐的状态/动作列。打开 Work SHALL 直接进入专属面板，无跨 Work 侧栏或强制概览；Service/Files/Chat 为同级入口，Settings 明确可达。

首次进入且无当前身份的有效上次区域时，可用 Service SHALL 为默认主区域，同一 Session 的 Agent 输入保留在辅助栏；首次进入且无有效上次区域时，无可用 Service 且对话准入成功则聚焦 Chat。停止状态 SHALL 展示 Start、配置、Export 与历史保留提示，不新读历史。切换区域 SHALL 保留当前 Service/端口、Session 和本页面非敏感草稿；不承诺任意应用内部未保存表单的恢复。所有列表 SHALL 区分加载、真正空集合、错误和带时间的旧内容。

共同颜色/字阶/间距/控件 SHALL 可集中修改；360px 无整页横向溢出，长名称和技术标识可完整读取/复制，危险/编辑弹层按 DUL-007 管理焦点及未保存确认。交付 SHALL 提供原型 36 帧/CLI 能力矩阵到实际界面与验收记录的对应关系。

同一有效身份的当前页面生命周期内，重新进入 Work SHALL 优先恢复上次明确选择的 Services、Files 或 Chat，以及仍存在且有权访问的 Service/port、Session、文件目录和已打开文件；首次进入才使用默认区域规则。恢复目标的读取使用该区域稳定外壳，不先强制切往 Services。目标失效 SHALL 说明原因并提供该模块可用回退，不能因后台加载晚到覆盖用户的新选择。离开脏文件/配置仍需既有确认；不将草稿或选择持久化到另一身份。

最后确认可用的 Work/Service 仅遇到状态观察网络错误、超时或暂时服务错误时，Desktop SHALL 保留同一已挂载应用视口与工作区，标记状态未确认及安全重查入口；不能因该读取错误卸载再创建 iframe、清除草稿或抢焦点。保留画面不表示刷新授权或确认 Ready，不扩大新动作准入；已确认停止/删除、停止目标接受、真实资格撤销及身份失效仍按原规则限制能力和撤销访问。

Desktop SHALL 按主流程、对象管理、全局管理分层：Ready Work 优先直接 Open，Stopped 保留 Start；Stop 与 Work information 在所属 Work 更多菜单；About Piwork、Known operations 在账号下拉。Files 空选择提示不占独立行，批量动作在已有工具栏；Service/Agent请求入口使用有可访问名称的就近图标，分别保留当前Service与全Work作用域。账号下拉外侧关闭不受背景草稿/任务阻碍，不扩大其他确认窗规则。

Service/Chat 工作区 SHALL 支持 DUL-002 的可拖动与键盘分隔、普通 Chat 折叠、专注返回及窄屏恢复；单纯布局变化不得切换 Session、清空文字/图片草稿、丢失 Desktop 阅读位置或重载同一授权 iframe。比例及显隐只在当前身份页面内按 Work 恢复；无有效记录或刷新使用默认布局。外壳 SHALL 使用真实剩余视口高度并按 DUL-007最多保留一条 StatusLine，不修改嵌入 Service 业务内容。Works三操作图标化及账号身份呈现 SHALL 仍提供完整操作目的和已有权限边界。

#### Scenario: 从列表进入并切换区域
- **WHEN** 用户打开有就绪 Service 的 Work，切到 Files、聚焦 Chat，再返回 Service
- **THEN** 始终保留 Work 身份，Service 为原选择，对话使用同一 Session 和草稿，不产生额外 Run

#### Scenario: 错误不是空列表
- **WHEN** Work 查询失败或返回空数组
- **THEN** 分别显示错误恢复入口或 New Work/Import 空态，不用零计数覆盖查询失败

#### Scenario: 列表与窄屏可操作
- **WHEN** 多种状态、长名称 Work 在宽屏及 360px 显示，用户通过键盘操作行按钮
- **THEN** 状态/动作保持可读且布局对齐，按钮不同时触发行导航，焦点与弹层返回位置正确

#### Scenario: 重进同一 Work 恢复上次区域
- **WHEN** 用户在 Files 的子目录或 Chat 工作后返回 Works，再打开该 Work
- **THEN** 恢复其有效区域与对象；加载不强制先展示 Services，无额外 Start、Session 创建或 Run，失效路径在 Files 内说明并回到可访问位置

#### Scenario: 一次观察失败不销毁可用视口
- **WHEN** 已挂载 Service 有输入，Work 状态 GET 暂时失败后恢复
- **THEN** 同一 iframe 及祖先保持连接，文档不重载、草稿和焦点保留，显示未确认及恢复；没有绕过服务端授权或将错误当成新的 Ready

#### Scenario: 确认停止或身份撤销不能保留可用假象
- **WHEN** 显示旧应用期间取得 Stop accepted、stopped/deleted 或可信授权失效
- **THEN** 执行原能力限制和撤销，显示对应对象与原因；旧可用快照不开放新的控制、文件或对话提交

#### Scenario: 调整布局不产生执行副作用
- **WHEN** 用户拖动/键盘调整、重置、折叠/展开Chat，经历Focus/Restore/Exit与窄屏往返
- **THEN** 原Work/Service/端口/Session保持合法选择，文字图片草稿、阅读位置及iframe文档不变，无新Session/Run/控制提交；返回不被旧响应覆盖

#### Scenario: 工作区高度不靠固定空白补偿
- **WHEN** 头部、导航、降级提示和Chat显隐改变实际可用空间
- **THEN** 主区域使用剩余高度，无额外外壳底边空白或被裁输入区；StatusLine不叠加，Service页面内部内容保持独立

### Requirement: Work 创建与生命周期使用真实控制结果

**Identifier:** DWUI-003

New Work SHALL 提供必需名称与默认创建，以及高级镜像、Skills/Packages 默认/选择/显式清空、AGENTS 文件/文本和完整配置 JSON；字段省略与空集合语义、合并顺序 SHALL 与现有用户 CLI 一致。校验失败保留输入，接受后显示 Work/Operation ID 与准备状态。

创建重名 SHALL 基于 Core 确认的名称冲突显示在 Name 字段附近，说明该名称已被使用或保留并要求选择其他名称；保留名称和全部高级输入，提供可访问错误关联，避免仅显示通用 CONFLICT 或重复错误条。显示原因不得通过客户端列表推断；其他状态冲突、配额、依赖或网络失败不得被改写为重名。已删除记录或在途导入的现有名称占用仍有效，提示不得承诺删除可见 Work 就能释放名称。

列表和 Work 面板 SHALL 支持 Start、Stop、Retry、Delete、公开身份及详情，遵守 DUL-008。Stop 确认影响当前 Run、Service 和文件连接；Delete 确认默认保留数据、不提供假撤销。仅 desired=running 的失败提供 Retry；停止失败查询原 Stop，不将目标改回运行。accepted、running、succeeded、failed、superseded 和 unknown SHALL 分开；删除后即使 Work 已不在列表，原 Operation 仍可查询。

New Work SHALL 区分未完成的创建草稿与可靠受理后的下一次新建。明确拒绝、未发送或结果未知时保留原输入和对应恢复保护；可靠取得原 Work/Operation 后，下次 New Work 默认使用新名称空值和当前默认配置，不静默继承上次高级覆盖。新建期间不得因旧创建晚结果清空较新的草稿，原已受理对象仍可找回。

Start/Retry 的进度 SHALL 留在所属 Work 上下文并保留原 Operation 详情入口。真实对象及相应能力确认可用后 SHALL 提供直接 Open Work；用户明确选择 Start and open 时才可在完成后衔接打开该 Work。普通 Start 不强制导航，不以 Operation succeeded 代替 Work Ready。

Stop确认的影响范围 SHALL 以明确非交互说明呈现，不能把装饰图标表现为不可勾选的Checkbox，也不得增加原流程没有的确认勾选门槛。真正Delete确认框、Stop/Stop and export的原动作与一次提交保护保持。

#### Scenario: 默认创建和显式空集合
- **WHEN** 用户分别使用默认配置及显式空 Skills/Packages 创建
- **THEN** 前者采用 Core 默认，后者不被默认填回；成功准备前不显示 Ready

#### Scenario: 停止取代启动
- **WHEN** Start 尚未完成时 Stop 已接受且旧 Operation 被取代
- **THEN** 当前目标为 stopped，旧操作显示 superseded，不能继续以旧结果显示 Ready

#### Scenario: 停止失败与删除
- **WHEN** 停止失败，或删除已接受而 Work 已离开列表
- **THEN** 前者不可 Export 且可查询原 Stop；后者保留 Delete 观察入口，不提前宣布清理完成

#### Scenario: 创建重名定位到名称字段
- **WHEN** 普通创建被 Core 以名称已被使用或保留拒绝
- **THEN** Name 字段附近显示可理解的英文换名提示，名称及高级草稿保持，没有假 Operation 或自动提交

#### Scenario: 重名提示只依据确认原因
- **WHEN** 创建发生名称冲突，或发生其他 CONFLICT、配额、依赖、连接失败
- **THEN** 仅确认的名称冲突使用重名字段提示；其他错误沿既有反馈处理，不因名称在列表中存在或不存在而猜测原因

#### Scenario: 创建请求返回前修改名称
- **WHEN** 用户提交名称 A 后在响应返回前改为名称 B，随后 Core 返回 A 的名称冲突
- **THEN** 说明原请求使用的 A 被拒绝，保留 B 与高级草稿，不把 B 标为无效，不自动再次创建；名称比较与实际提交一样忽略首尾空白

#### Scenario: 两次创建冲突逆序返回
- **WHEN** 同一创建表单先提交名称 A，再由用户显式提交名称 B，B 的名称冲突先返回，A 的名称冲突随后返回
- **THEN** 保留 B 的当前名称、高级草稿、Name 字段错误及可访问关联；A 的迟到响应不得覆盖或清除 B 的表单错误，旧请求仍按原记录处理，不产生额外创建请求

#### Scenario: 已受理创建后的下一次新建
- **WHEN** 创建 A 可靠受理后用户再次 New Work
- **THEN** 新草稿不带入 A 名称、AGENTS/JSON 等高级覆盖；A 的 Operation 仍可查，没有第二次隐式创建

#### Scenario: 未知创建保留原草稿
- **WHEN** 创建响应丢失或明确拒绝，用户关闭并回到该创建流程
- **THEN** 原输入保留，未知仍核对原结果而非新建重发；晚到的原接受不会清空其他新草稿

#### Scenario: 从列表启动后可直接进入
- **WHEN** 用户从 Works 显式 Start，原操作和 Work 相继确认成功及可用
- **THEN** 原行或结果处直接提供 Open Work，不必关闭 Operation 再重新定位名称；Start 只提交一次

#### Scenario: 停止范围没有假勾选控件
- **WHEN** 用户打开Stop Work或Stop and export确认
- **THEN** 可读到整个Work、Service、Agent和Files影响，范围说明不伪装可点选项；取消零提交，确认只提交原授权动作一次

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

### Requirement: Service 管理与数据上下文清楚分离

**Identifier:** DWUI-005

Desktop SHALL 实现 DUL-004、006、013：Service 列表/详情包含禁用、失败、非 Web 服务，提供公开域名/端口、Start/Stop/Restart/Retry/Remove 和有界日志刷新，访问行为遵循 `browser-service-access`。Stop 是持久禁用，Start 不启动停止的 Work，Remove 保留共享文件且无法以 Start 撤销。日志 SHALL 显示取得时间、截断及不可用原因，不伪装实时终端。无效动作说明原因，控制完成以原 Operation 为准。

所选 Service SHALL 只提供明确的身份上下文，不自动读取或上传页面 DOM、输入、截图和内存。用户请求分析时 SHALL 通过 Agent 的实际文件/API 能力取得数据，并要求回答说明来源；无来源时说明不可访问，不声称浏览器已同步数据。现有 Service 创建/定义更新仍由 Agent 工作流完成。

Pi 开发且实现交互契约的 Service SHALL 可以主动记录页面路径和业务动作，并向 Agent 提交显式请求；这些事实由 Service 的事件/API 提供，不是 Desktop 对任意网页的监听。Service 详情和 Work 请求检查面板 SHALL 能查询该 Service 的处理记录、事件来源和证据；仅有普通事件不启动自动 Run。未接入契约的外部 Service SHALL 只显示平台已经确认的状态、日志、可访问性以及 Agent 实际读取到的外部信息，不声称掌握其内部用户操作。

打开 Service 详情 SHALL 先呈现该对象已知身份、状态和按真实准入可用的控制，日志作为独立内容加载。日志慢响应或失败 SHALL 仅影响日志区域，提供日志重试及取得时间；不得阻止进入详情或把合法控制一并隐藏。旧 Service/身份的日志晚结果不能覆盖当前对象。

Starting、Failed、Disabled 和无 Web 入口 SHALL 分别说明真实原因；仅已确认未启用才使用 Disabled 解释。用户 Start/Restart/Retry Service 后 SHALL 保留原 Service 上下文和原 Operation 入口，结果确认后可返回该 Service，并在真实浏览器入口可用时提供 Open Service。详情/处理记录关闭使用 Close，真正取消请求仍使用 Cancel request，不混淆关闭观察与业务取消。

Service选择器 SHALL 使用已确认的名称、observed、enabled及声明Web端口，区分应用切换和Manage services。单端口轻显示，多端口独立选择；非Web/Removed对象不伪造应用入口。切换不可用Service仅选择并解释原因，不自动Start；其他Service/端口的晚准备结果不得覆盖当前选择，Chat上下文保持。

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

#### Scenario: 日志失败仍可管理服务
- **WHEN** 用户打开 Service 详情，日志 GET 挂起或返回 503
- **THEN** 身份与状态立即可读，符合当前准入的控制可用，日志区域有等待/错误及重试；日志重试仅读取日志

#### Scenario: 切换服务后旧日志返回
- **WHEN** Service A 日志未返回时用户查看 B
- **THEN** B 的身份、控制和日志不被 A 的晚结果覆盖，旧结果不弹回 A

#### Scenario: 服务开始运行后可继续使用
- **WHEN** Service 控制达到确认结果且入口可用
- **THEN** 当前详情保留对应对象并提供访问入口；Starting/Failed 无额外错误字段时仍不误称 Disabled

#### Scenario: 关闭请求详情不取消执行
- **WHEN** 用户在活跃 Pi request 详情点击 Close
- **THEN** 只关闭详情，未发送取消请求；只有明确 Cancel request 才改变原请求

#### Scenario: 紧凑选择器保留真实状态与端口
- **WHEN** 多个Service具有长名称、不同状态或多个声明端口，用户快速切换及用键盘关闭选择器
- **THEN** 名称/状态/端口与选中项对齐可读，焦点回触发器，只打开当前合法目标；无自动Start、未声明端口或Chat切换

### Requirement: 浏览器文件操作覆盖共享 workspace

**Identifier:** DWUI-006

Files SHALL 以当前 Work 的整个共享 workspace 为根（包含隐藏项），通过本地认证入口调用 Core WebDAV；仅运行且文件准入成功时可读写。SHALL 实现 PROPFIND 列目录、GET 下载/文本读取、PUT 上传/保存、MKCOL、同 Work MOVE/COPY/DELETE，准确处理 Destination、Location、DAV href、中文与百分号路径及逐项错误。工作根不可删除、移动或重命名，符号链接/特殊项按真实类型限制，不能穿越根或跨 Work。

文本编辑 SHALL 限于至多 1 MiB、合法 UTF-8 且不含 NUL 的普通文件；超限或二进制提供 Download。编辑不自动保存，不承诺锁/ETag/自动合并，离开前明确 Save/Discard/Keep editing；保存前展示并发覆盖风险，已知修改时间可用时携带条件请求，冲突先重读，不自动覆盖。上传逐文件显示结果，已存在目的地须明确覆盖；目录操作可递归时先说明影响。

SHALL 遵守 Core 文件限额及单 Work mutation 并发限制；浏览器默认逐文件上传，无隐式写入重试。`207` 展示成功/失败路径，未知写入要求重读实际目录。普通下载不表示一致性备份，不提供目录 ZIP 或跨 Work 操作。文件能力缺失 SHALL 只局部降级。Connect with WebDAV SHALL 展示现有 proxy 命令、完整 Work URL 和终端临时密码获取方法，浏览器 Files 不依赖该流程。

编辑保存 SHALL 将 `If-Unmodified-Since` 绑定到读取正文时已知的修改时间；后台目录刷新不得将脏编辑的读取版本偷偷升级。新文件上传 SHALL 使用 `If-None-Match: *`，防止 HEAD 确认不存在后出现的文件被覆盖。既有文件覆盖 SHALL 绑定用户确认的路径及已知修改时间，发送已有条件请求；读取失败不视为不存在。条件冲突 SHALL 保留本地编辑或待上传 File，展示先重读/比较的恢复入口，不能自动改成无条件 PUT。重读 SHALL 分别保留用户草稿和新保存版本；再次覆盖重读版本须用户明确同意。有可用条件时使用条件，无可用修改时间时 SHALL 明示不能进行版本保护并要求显式覆盖同意，不宣称具有文件锁或强一致保护。

文本编辑器 SHALL 直接提供 Download saved version，下载真实已保存文件；未保存编辑保持且不自动 PUT，不以草稿内容冒充服务端版本。Copy/Move/Delete/Rename 的逐路径结果 SHALL 在仍打开的操作弹层内可读，分别显示成功、明确失败和未知及下一步；不要求关闭弹层才能查看错误原因。失败项输入保留；未知先核对原路径，成功项不因再次确认被盲目重做。

New folder/Rename SHALL 在打开后将焦点置于命名字段；Rename 预填原 basename，文件名选择优先主名并保留扩展名，目录可全选。普通 Enter 仅对该字段合法且未 busy 的现有提交动作生效，输入法组合期间 Enter 不提交，危险/覆盖确认不继承通用 Enter 快捷提交。

Files常规工具栏 SHALL 仅有一个Refresh，并以＋菜单承接Upload/New folder，不在Workspace options重复相同刷新或已有WebDAV入口。等待/成功按DWUI-019在原刷新控件呈现，不增加额外Status checked行或重复成功toast；列表选择、编辑草稿、未知写入及逐路径错误规则保持。

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

#### Scenario: 用户编辑期间 Agent 更新同一文件
- **WHEN** 用户读取带修改时间的文件后编辑，Agent 在下一秒或更晚更新该文件，随后用户保存
- **THEN** PUT 携带原修改时间，Core 的 412 被显示为冲突；Agent 的内容保留，本地草稿保留，没有无条件重试

#### Scenario: 新建上传的 HEAD 与 PUT 之间出现同名文件
- **WHEN** HEAD 返回 404 后另一写入者创建了同名目标，随后上传发送 PUT
- **THEN** PUT 包含 `If-None-Match: *`，返回条件冲突，不覆盖新出现的文件；待上传文件保留，须重读并显式确认覆盖

#### Scenario: 确认覆盖后目标再次变化
- **WHEN** 用户确认覆盖的既有目标在 PUT 前以可辨别的新修改时间变化
- **THEN** 原确认版本的条件请求失败；页面保留上传输入并要求重新核对，不自动以最新版本刷新覆盖同意

#### Scenario: 重读不自动覆盖草稿或重复写入
- **WHEN** 条件冲突或未知保存结果后用户重读文件
- **THEN** 新保存版本与本地草稿分别可查看，重读本身仅 GET；用户明确接受新的覆盖基线并再次保存才允许下一次 PUT

#### Scenario: 在编辑器下载已保存文件
- **WHEN** 用户打开文本并保留未保存修改后点击 Download saved version
- **THEN** 直接发起保存版本下载，草稿保持且没有 PUT；发起下载不宣称已落盘

#### Scenario: 失败结果在当前弹层可见
- **WHEN** 一项 COPY/MOVE/DELETE 明确失败或响应未知而操作弹层仍打开
- **THEN** 该路径、结果和原因在弹层内可读，提供安全核对方向，不被背景详情遮挡或自动重发

#### Scenario: 混合结果不整体重试
- **WHEN** 合成两路径操作返回一项成功和一项失败/未知
- **THEN** 弹层分别显示实际结果，不声称整体回滚；已成功项不会被盲目重做，未知项先只读核对

#### Scenario: 命名可直接输入并安全提交
- **WHEN** 用户打开 New folder 或对中文、带点、无扩展名文件及目录 Rename
- **THEN** 字段正确聚焦并预填适用名称，普通 Enter 最多提交一次，IME Enter 不提交，失败保留输入，取消不修改

#### Scenario: 刷新菜单整理不影响文件保护
- **WHEN** 用户通过唯一Refresh重读列表、通过＋上传/建目录，或在未知写入后核对
- **THEN** 工具栏与文件行位置稳定，菜单键盘可达，仍使用原目录和条件保护；正常成功不插新行，未知只核对原目标

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Settings SHALL 按 DUL-014 完整提供 Skills 目录与 Work 选择/清空、AGENTS 当前/待应用内容及导入编辑、Advanced 完整 JSON show/set、Pi Package 目录及 Work 已安装项。In use、Saved changes、Not applied、runtime loaded/modelVisible SHALL 各自对应真实状态。目录不可编造说明；重选 Core 副本与保留 Work 副本的语义须明确。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

piwork-brain SHALL 使用现有 Pi Packages 与 Files 产品流程。Files 中 `.pi/packages/piwork-brain/` 是可编辑源；Settings 中 loaded/modelVisible 对应 active 捕获包，不能因文件已修改就宣称采用。候选详情 SHALL 展示来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态，区分包已加载与实际 SDK 行为已核验。用户显式 Apply 期间仍允许后续配置编辑；晚返回候选不得覆盖无关的新 desired。自动验证只能在有效加载之后运行，不能在 Apply 初始化中调用模型。

候选详情 SHALL 在现有 Package Details 分项展示受理时 active/desired 选择与当前匹配摘要、固定目标及能力、安全输入摘要和必要 checks、准备发布结果、对应 Apply 原 ID/状态，并能按原 ID 打开既有请求/Operation 详情。内部 context identity、制品 digest、凭据和宿主路径 SHALL 不成为展示字段。没有匹配 Apply、观测不可用、加载失败与行为失败 SHALL 分开，不能用 Saved/Loaded 标签或缺字段 JSON 代替这些信息；打开或刷新详情不提交修改，也不重载 Service iframe。

Skills、Packages、AGENTS.md 与 Advanced SHALL 展示同一份未保存配置；保存结果 SHALL 不取决于当前页签。有效 JSON 中的显式空集合和空 AGENTS 内容 SHALL 保留，未在普通表单编辑的其他公开字段 SHALL 保留；重复编辑同一字段采用最后一次有效显式编辑。非法 JSON SHALL 保留输入并定位错误，阻止配置提交与向其他配置页签转换，用户仍可修正或明确放弃草稿。保存失败或结果未知 SHALL 保留完整非敏感草稿，不触发 Apply。

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

Open brain source SHALL 经既有脏配置/文件离开保护后导航到当前 Work 的 Files 并打开明确源文件，成功后关闭原详情且退出 Settings 路由。读取失败 SHALL 在目标上下文显示真实原因与重试，不虚构已经打开；取消离开确认保持原设置与草稿，不丢目标文件身份或擅自保存/Apply。

Settings的Back to Work SHALL 作为左侧内容返回导航，恢复原有效区域/对象，并区别顶栏Back to Works；未保存保护保持。saved与active一致时 SHALL 使用轻量状态及按需配置详情，不占用大型正常状态卡或无意义的禁用Apply主动作；Unsaved、Not applied、Applying、失败/未知及安全下一步仍直接可辨。省略正常说明不得合并Save/Apply或把Loaded当成验证完成。

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

#### Scenario: Advanced 修改后从其他页签保存
- **WHEN** 用户在 Advanced 修改 Skills、Packages、AGENTS.md 和其他公开字段，切到 Skills 或 AGENTS.md 后保存
- **THEN** 相应页签展示新值，提交包含全部修改，不用原表单值覆盖 JSON；保存仅更新 desired

#### Scenario: 普通表单修改后从 Advanced 保存
- **WHEN** 用户先修改 Skills、Packages 或 AGENTS.md，再打开 Advanced 保存
- **THEN** JSON 展示并提交普通表单的新值，显式空值保留，同一字段最后一次有效编辑生效

#### Scenario: JSON 非法时尝试转换或保存
- **WHEN** Advanced 存在无法解析的 JSON，用户切换配置页签或点击任一保存入口
- **THEN** 保留原文及脏状态，显示定位错误，不转换到另一配置页签、不发配置 PUT；明确 Discard 可放弃该草稿

#### Scenario: 目录失败后恢复
- **WHEN** Skills 或 Packages 曾读取失败，随后用户刷新获得有效目录
- **THEN** 清除对应不可用反馈并恢复合法动作，用户现有选择和草稿保持不变，不覆盖 Core 离线或运行环境未就绪的真实状态

#### Scenario: 目录部分失败及空集合
- **WHEN** Skills 成功而 Packages 失败，随后 Packages 成功返回空数组
- **THEN** 首次只提示 Packages 错误且保留 Skills；后续显示真实空 Packages 目录并清除其错误，保留 Work 已保存副本和未保存选择

#### Scenario: 从脑包详情直接打开源码
- **WHEN** 用户在 Pi Package 详情点击 Open brain source 且文件可读
- **THEN** 进入该 Work Files 的目标 brain.md 编辑器，原详情关闭且路由不再停在 Settings，无需额外找文件

#### Scenario: 脑包导航尊重未保存编辑
- **WHEN** Settings 存在草稿时用户 Open brain source 并取消离开
- **THEN** 仍在原 Settings/详情并保留草稿，没有隐式 Save、Apply 或文件写入；同意离开后才进入目标文件

#### Scenario: 设置正常态简洁而异常仍明确
- **WHEN** 配置分别为一致、未保存、已保存待Apply、Apply中、失败或未知，用户刷新并返回Work
- **THEN** 仅一致状态降为轻提示，其余状态及合法动作明确；返回原区域并执行未保存保护，不自动Save/Apply或丢失后续草稿

### Requirement: 完整 Work 包可以本地检查和原子导入

**Identifier:** DWUI-008

用户 SHALL 能选择 `.work` 在本地完整 Inspect，无需 Core 登录、不执行包内代码，显示既有安全摘要和私有内容提醒，允许检查后直接关闭。上传与检查 SHALL 流式处理并遵守现有 `.work` 格式、完整校验及容量限制，不将整个包放进浏览器/CLI 内存。

Import SHALL 复用检查后的同一包，提交前校验仍一致；名称留空真正省略，显式冲突定位名称字段；目标权限与模型兼容由 Core 校验。上传不虚构 Operation；接受后保留原 ID，发布前/失败时无半成品 Work。成功展示最终名称、新 ID 与 Imported · Not started，并提供显式 Start and open 和仅查看/暂不启动入口。不自动运行 Service 或包代码。取消未提交传输可清理本地暂存；取消观察不撤销已接受 Import。

同一本地浏览器会话在同一 Core 下从匿名检查进入首次登录时，SHALL 保留已完整验证且未提交的包和其本地传输身份；登录成功后可继续检查摘要并显式导入，无需重新选择文件或上传到本地 CLI。登录失败不丢弃合法匿名检查。此例外 SHALL 不保留已认证用户的 Core 内容，亦不适用于切换 Core、已认证用户切换账号、登出或本地会话失效。

用户关闭未提交检查、替换所选包或取消仍在进行的本地检查时，SHALL 中止相应本地传输/观察并请求释放原暂存；晚到的进度和结果不得重新打开旧检查或覆盖新包。删除确认成功或已不存在后才显示清理完成，失败时保留可定位的清理信息与显式重试入口，不能以隐藏弹窗代替清理。为同一 Core 登录而暂离检查不属于放弃该包。Import 提交中、接受响应未知及已接受后 SHALL 保留该次身份及恢复信息，不按未提交检查重新提交、替换或取消远端操作；关闭仅停止本地观察。

Start and open SHALL 只在用户于导入成功后明确选择时提交 Start，并在真实 Work 及能力确认后打开；导入成功、详情关闭、状态查询或查看控制信息都不能自动启动外来包。启动失败/未知保留导入成功事实、原 Start 身份及安全恢复，不重复 Import。

本地 Inspect 摘要 SHALL 提供来自已验证包的 `sourceName` 显示字段，用于本页自动改名前后的名称说明；该字段不改变包格式、校验或导入执行。

Import 名称字段 SHALL 在提交前说明：留空使用包内源名称，名称不可用时由 Core 自动添加唯一后缀；显式名称须可用。客户端不得依据列表预测或提前承诺具体后缀。受理后 SHALL 使用现有接受响应的最终 `name` 显示本次导入目标名称；只有未显式指定名称且 Core 最终名称与已确认源名称不同，才能说明自动改名并显示原名称和实际名称。用户显式选择不同名称不应被描述为 Core 因重名自动改名。

显式名称冲突 SHALL 在名称字段旁给出换名或主动留空的英文提示，保留名称、已检查包及其他输入；不得自动清空、修改名称或重新发送 Import。修改和后续提交仍遵守既有 transfer 准入、未知结果保护与用户显式提交规则。

实际名称 SHALL 与状态一起准确表达：接受时为已选定的导入名称及准备中，只有 Operation 确认成功才称为导入完成。失败、响应丢失或恢复后尚无名称时不猜测名称或成功；可沿现有接受记录和 Work 读取显示已确认名称，不新增恢复接口或持久状态。

#### Scenario: 离线检查后关闭
- **WHEN** 未登录用户选择合法或损坏的本地包
- **THEN** 本地分别显示完整验证摘要或具体校验失败，不连接 Core 或执行内容，关闭后清理暂存

#### Scenario: 自动名称和显式冲突
- **WHEN** 导入同名包时分别留空名称或显式填入冲突名称
- **THEN** 前者由 Core 选择名称，受理后显示实际名称及适用的自动改名说明；后者保持表单并在名称字段旁提示冲突，均不覆盖旧 Work

#### Scenario: 导入完成或失败
- **WHEN** 已接受 Import 进入终态
- **THEN** 成功才显示 stopped 新 Work，失败保留 Operation 和原因，均不自动 Start

#### Scenario: 留空名称并由 Core 自动改名
- **WHEN** 包内源名称为“笔记”，用户留空名称，Core 因现有占用返回实际名称“笔记-3”
- **THEN** 提交前只说明自动后缀规则；接受后显示“笔记”与“笔记-3”的自动改名事实，不猜测“-2”，不提前宣布导入完成

#### Scenario: 显式名称冲突后保留检查与输入
- **WHEN** 用户显式指定的名称冲突，随后自行选择另一名称或留空
- **THEN** 冲突紧邻名称字段，原检查和输入保留；仅在既有准入允许且用户再次明确提交时执行 Import，不自动改名、重复上传或发送

#### Scenario: Import 请求返回前修改名称
- **WHEN** 用户提交显式名称 A 后在响应返回前改为其他名称或主动留空，随后 Core 返回 A 的名称冲突
- **THEN** 说明原请求使用的 A 被拒绝，保留当前输入与已检查包，不把当前字段标为无效，不自动清空、改名或发送；名称比较与实际提交一样忽略首尾空白

#### Scenario: 显式新名称不误报自动改名
- **WHEN** 用户明确将源名称“笔记”改为可用的“研究笔记”，Core 接受该名称
- **THEN** 显示实际导入目标为“研究笔记”，不声称 Core 因名称冲突自动改名

#### Scenario: 名称与受理失败恢复分开
- **WHEN** Import 已接受但仍在准备、随后失败，或恢复查询尚未取得实际名称
- **THEN** 已确认名称只作为该次目标名称显示，状态保持真实；失败不显示导入完成，未确认名称不从源名称或列表推测，不产生新的 Import 请求

#### Scenario: 匿名检查后登录同一 Core
- **WHEN** 本地检查成功，用户通过 Sign in to import 登录原 Core 后继续导入
- **THEN** 保留原传输及摘要，只使用原 transfer ID 提交 Import；本地检查上传不再执行，用户确认前不发送 Core 导入请求

#### Scenario: 登录失败或切换 Core
- **WHEN** 检查后登录原 Core 失败，或改为切换另一个 Core
- **THEN** 前者保持匿名检查以便重新登录；后者清理旧检查且不向新 Core 提交旧包，身份内容仍按现有隔离规则处理

#### Scenario: 检查期间取消或连续换包
- **WHEN** 检查正在传输时用户取消，或选中另一个包替换旧检查
- **THEN** 原本地传输/观察停止，原暂存被请求删除，旧响应不回填；新检查仅使用自己的 transfer ID 和结果

#### Scenario: 暂存清理失败
- **WHEN** 用户放弃未提交检查，但删除请求失败或响应丢失
- **THEN** 保留旧 transfer ID 的清理提示及显式重试入口，不宣称磁盘已释放，不影响其他 Work 或删除 Core 快照

#### Scenario: 导入接受后关闭观察
- **WHEN** 已提交 Import 的响应未知或已取得 Operation ID，用户关闭检查或操作弹窗
- **THEN** 保留该次导入及恢复身份，只停止本地观察，不调用远端取消、不发第二次 Import，也不以重新选择包替代核对原结果

#### Scenario: 导入后由用户选择启动并打开
- **WHEN** Import 已成功发布 stopped Work，用户先仅查看，随后明确 Start and open
- **THEN** 仅查看不运行任何包代码；显式选择后 Start 一次，确认可用才打开原新 Work，没有第二次 Import

### Requirement: 导出与下载保持显式阶段及原快照恢复

**Identifier:** DWUI-009

Export SHALL 按 DUL-009 清楚呈现停止（需要时）、生成、传输校验与浏览器下载的真实阶段；一次明确的 Export current Work and download 可授权连续执行后续必要步骤，不要求每阶段额外点击。仅 desired/observed 均 stopped 且无已知冲突时可提交，最终准入以 Core 为准；只有用户在明确影响确认中选择 Stop and export 后才可提交 Stop 并继续；普通导出入口或旧快照查看不能隐式 Stop，Export 不暗中 Apply、另行取消 Run 或启动 Work。接受后保留 Operation/snapshot ID，成功且完整校验后可下载。完整 `.work` 使用既有快照格式，包含 workspace 及格式定义的其他持久内容，文件浏览下载不能替代它。

下载 SHALL 复用原 snapshot，流式传输、核验长度/hash，失败不能显示保存完成；过期明确提示用户重新发起 Export，不静默创建快照。SHALL 提供按 snapshot ID 找回下载。浏览器下载动作仅能确认发起时显示 Download started，不宣称实际落盘完成；敏感包提醒在下载前可见。临时空间不足必须可见且不删除 Core 已生成快照。

从 Work 进入导出 SHALL 始终保留显式“导出当前内容”的新尝试入口，不能被已有成功快照遮蔽；新尝试使用自己的提交身份。旧快照下载 SHALL 与新导出分开标识，显示可靠取得的 ID、状态、大小与过期信息；无可靠生成时间时不伪造时间，不称为当前最新内容。按 snapshot ID 或某个导出 Operation 打开时 SHALL 精确使用原 snapshot，不能再按 Work 随意选另一份；新导出后续下载只能使用本次 acceptance 对应的 snapshot。

一次交付意图 SHALL 绑定发起时有效 Core、用户、本地授权、Work 及原操作/快照/传输，页面内导航或收起面板不取消该意图。同一意图在未被用户手动暂停、snapshot 成功并经 CLI 完整验证且原 transfer ready 后最多自动发起一次浏览器内容下载；重复状态、晚 POST 与只读恢复不得重复触发。浏览器可能拦截或由用户取消保存，界面 SHALL 保留同一已验证 transfer 的显式 Save file / Download again，不重新打包。

未知 Export/下载准备结果 SHALL 先查询原对象，不重放 POST 或生成新意图；无可查原身份时说明恢复限制。停止失败/未知、实际尚未停止、快照失败/过期、完整性校验失败或身份失效均阻止继续交付。切换 Core/账号、注销或本地授权失效撤销旧自动交付；重新登录或重载页面只能查询已知原结果并由用户显式继续下载，不恢复未保存的自动交付意图。此行为不构成持久后台队列或跨页面卸载/进程续传。

用户对导出流程明确 Pause 时 SHALL 暂停尚未开始的下一阶段和自动内容交付；已经接受的远端操作不被取消，晚结果可按原身份记录但不推进。Check status/Check transfer SHALL 仅核对原结果，不解除手动 Pause；只有明确 Resume 并核对原结果后，仍有效的意图才可继续尚未提交的下一阶段或单次交付，不重放原未知修改。关闭进度不是 Pause。

#### Scenario: 运行中请求导出
- **WHEN** Work ready 或 stopping 时用户进入 Export
- **THEN** running 状态提供目标和 Run/Service/文件影响明确的 Stop and export 确认；确认前无 Stop/Export，确认后只 Stop 一次并待真实停止再导出。已在 stopping 时说明等待原停止，未确认前无 Export，不重复 Stop

#### Scenario: 状态显示停止但 Core 拒绝
- **WHEN** Core 发现实际写入者或快照锁而拒绝 Export
- **THEN** 显示安全原因和恢复入口，不提供半成品下载

#### Scenario: 下载断开或过期
- **WHEN** 下载失败后用户重试，或快照已过期
- **THEN** 有效快照使用原 ID；过期显示明确原因，需要用户重新 Export，不自动重做

#### Scenario: 停止态一次导出并发起下载
- **WHEN** 用户在已确认 stopped Work 显式导出当前内容，原 Operation/snapshot 成功且 CLI transfer 完整验证 ready
- **THEN** 同一进度上下文衔接生成和校验后发起一次浏览器下载，没有必经 View package/再次 Download；保留实际阶段、原 ID、隐私提醒和手动保存入口

#### Scenario: 停止并导出的失败不越过前置条件
- **WHEN** 用户确认 Stop and export 后停止失败、未知或 Work 尚未确认停止
- **THEN** 保留原停止操作与导出目标，显示对应安全恢复，没有 Export 或半成品下载；只读确认恢复后才允许沿已授权目标继续

#### Scenario: 导出最新内容与下载旧快照分开
- **WHEN** Work 曾导出后又被用户修改并再次停止，且已知两份快照
- **THEN** 显式新导出仍可用且绑定新 snapshot；按旧 ID 打开只下载该旧快照，数组顺序变化不替换目标

#### Scenario: 关闭进度仍完成原交付
- **WHEN** 用户发起导出/下载后关闭面板并在同一有效身份内浏览另一 Work，原 transfer ready
- **THEN** 保留原目标归属且最多一次发起原文件下载，不弹回旧详情、不替换新 Work 内容；可见通知指明原 Work 与下载发起事实

#### Scenario: 准备响应丢失后恢复交付
- **WHEN** 原下载准备 POST 响应丢失，随后 Check transfer 确认原 transfer ready
- **THEN** 只查询原 transfer；仍有效、未手动暂停且未消费的当前页面交付意图发起一次下载，已发起则不重复，没有新 Export/准备 POST

#### Scenario: 切换身份或重载不自动交付
- **WHEN** 下载准备期间注销/切换 Core或账号/失去本地授权，或页面重载
- **THEN** 旧自动交付失效，晚结果不下载也不进入新身份；同身份重新授权后可显式查询/下载原结果，不假称续传或落盘

#### Scenario: 自动下载被浏览器拦截
- **WHEN** 已验证包的自动浏览器下载未被浏览器接纳或用户未保存
- **THEN** 保留明确手动 Save file / Download again 入口及原 transfer，不重新生成或重新准备，不把 Download started 写成保存完成

#### Scenario: 手动暂停门控后续导出交付
- **WHEN** 用户 Pause 原导出观察后原 snapshot/transfer 的晚结果变为 ready，随后先 Check 再 Resume
- **THEN** Pause 和 Check 期间只记录/核对原事实，不发新的阶段 POST/content；明确 Resume 核对后才沿仍有效的原授权意图继续，已提交或已消费阶段不重复

### Requirement: 已知操作恢复不形成隐式任务队列

**Identifier:** DWUI-010

Desktop SHALL 提供 Operation ID 查询和按需活动区，覆盖 Work、Service、Apply、Packages、Import、Export。已接受操作持久记录仅含 Core/用户归属、类型、相关身份 ID 和时间；页面重载后重新查询原对象，不能称为全局历史。记录不得包含凭证、提示词、文件正文、包字节或来源秘密。未知结果 SHALL 保留最后确认时间、原 ID 和 Check status；无 Operation ID 的未知提交不能自动再发，提示核对对象状态。

多窗口与观察重连 SHALL 不导致重复 mutation。请求进行时防重复点击，关闭普通详情仅结束该详情展示/读取观察，不取消远端执行；已经明确授权且仍有效的导出交付按 DWUI-009/013 继续；有幂等键的提交保持该次键且不用于新意图。读失败采用有界退避，鉴权失败进入恢复，404/410 不无限重试。用户可清除本地记录，不改变 Core 对象。

#### Scenario: 删除后重载
- **WHEN** Delete 已接受且列表已无该 Work，用户刷新页面
- **THEN** 从当前身份已知记录恢复原 Operation，仍可查看清理结果

#### Scenario: 提交响应丢失
- **WHEN** 控制请求已发送但未取得 Operation ID
- **THEN** 显示结果未知并引导核对状态，不自动再次提交，不虚构 ID 或失败终态

#### Scenario: 多窗口观察同一任务
- **WHEN** 两个窗口恢复同一个已知 Operation
- **THEN** 二者只查询该任务，无新增 mutation，切换身份后不读取旧身份记录

### Requirement: 等待状态按对象防重复并允许离开和独立操作

**Identifier:** DWUI-012

Desktop SHALL 只限制该提交的重复入口和同对象的冲突修改，禁止用一个异步动作禁用整页按钮。同一 Work 文件修改串行，同一 Service 控制提交串行，同一配置提交串行；同 Work 生命周期提交期间限制冲突写入。取得 acceptance 后提交锁 SHALL 释放，后续准入仍按真实对象状态及既有控制语义，允许合法 Stop 取代未完成 Start；不能将 Operation 观察当作全局锁。身份变更提交期间阻止新的平台修改，既有匿名 Inspect 规则保持。

Service 控制提交的对象 SHALL 按发起时的 Work 与 Service 身份绑定，不包含浏览器入口端口。切换端口、关闭再打开详情或换用另一控制入口不能绕过同一 Service 的在途冲突锁；其他 Service 的合法动作保持可用。Service 预览、入口准备及其缓存仍按 Work/Service/port 区分。

等待期间 SHALL 保留普通 Close/Back、复制及无关对象的合法动作，导航仍检查脏草稿。关闭普通详情或离开模块只结束当前展示/读取观察，不暗中取消远端 Operation、Run 或已提交修改；DWUI-009 的明确导出交付意图与面板展示独立，继续其必要只读观察和已授权后续步骤。未提交 Inspect 的 Cancel/Escape 仍释放本地暂存；提交中/未知/已接受 Import 保留原身份并只停止展示。界面 SHALL 明确这些不同的关闭含义。

反馈 SHALL 绑定发起时的 Core/账号、Work/对象及该次动作。切换对象后晚结果不能打开旧弹层、覆盖新内容/草稿或显示为新对象的成功；同身份已接受操作仍能按原 ID 找回。新身份不得取得旧内容或传输。失败/终止后 SHALL 释放相应等待状态，保留已有安全约束；未知修改不能通过重新启用按钮暗示可直接再次提交。保存期间允许继续编辑时，成功只确认已提交草稿，新编辑仍为 Unsaved。

未知修改的只读核对 SHALL 匹配原 Core/账号、Work、动作及涉及资源，并依据实际返回对象判断核对范围。查询其他 Work 的 Operation、同 Work 的无关 Operation 或未确认关联关系的记录不得解除原动作的未知结果锁；不得因为一次查询成功而批量解除当前 Work 的生命周期、传输和 Agent 锁。已有接口能够确认原目标的当前事实或原业务身份时，才可恢复对应动作的既有准入，并保留原提交结果未知与当前事实已核对的区别；无法确认时继续提供原对象核对入口，不自动重发、不暗示可直接重试。

#### Scenario: 等待下载时关闭或执行独立动作
- **WHEN** 当前 Work 的下载准备尚未完成，用户关闭 Export 并查看另一 Work
- **THEN** Close/Back 可操作，另一个 Work 的合法动作不被禁用；原准备不会自动再次提交，原结果可在原上下文找回，未手动暂停的有效原交付意图完成后最多一次发起原文件下载并明确原 Work；不会打开旧弹层或覆盖新对象，身份失效则不得自动交付

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

关闭 Download 弹层仅收起进度，不取消原准备或 DWUI-009 中有效的一次交付意图；未被用户手动暂停且完成/恢复 ready 时可在同一有效身份内自动发起原文件下载一次，原 Export/活动上下文持续提供同一 transfer 的手动保存回退。新的界面不被旧结果覆盖。页面卸载、本地身份失效或 CLI 退出的传输边界沿用现有行为，不能承诺后台跨进程续传。Inspect/Import 的已有本地检查与明确提交、释放及未知恢复保持 DWUI-008 与既有修复规则。

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
- **THEN** 保留原 snapshot/transfer 和最后确认时间，仅重新查询原传输，按仍有效、未手动暂停且尚未消费的原交付意图单次发起同一内容下载，并保留手动回退；不重新提交准备、重复发起或声称文件已落盘

#### Scenario: 有界本地等待与未知总量
- **WHEN** 进度没有 total，或已等待十秒但未取得新确认
- **THEN** 分别显示不可量化阶段或仍在等待确认及已等待时间，不假造百分比、超时失败或新的修改请求

### Requirement: Work 生命周期以接受目标和确认状态共同呈现

**Identifier:** DWUI-016

Desktop SHALL 在 Work 列表行、Work 身份栏、生命周期状态页和原 Operation 详情中一致区分本次请求提交状态、已接受目标、Core 已确认 observed 状态与观察是否成功。`provisioning` SHALL 显示 Preparing，`starting`、`ready`、`degraded`、`stopping`、`stopped`、`failed` SHALL 分别显示 Starting、Ready、Degraded、Stopping、Stopped、Failed；确认 deleted 的 Work 不再作为可运行条目显示，真实未知值或未确认状态 SHALL 有检查入口而不默认 Ready。

Create/Start/Stop/Retry/Delete 接受后 SHALL 立即提供原 Work/Operation ID 和相应目标，例如 Start accepted 或 Stop accepted；后续 Work 查询缓慢时仍可查看原操作。界面 SHALL 保留最后确认状态并说明目标尚在执行，不把 acceptance 写成 Ready/Stopped/Deleted；进度仅显示已取得的状态和阶段，不生成固定百分比或未取得的执行步骤。细阶段缺失时 SHALL 显示 Starting Work / Stopping Work 等对象动作及执行状态，原始状态、ID、确认时间在详情可查。

列表与面板快捷动作 SHALL 使用同一准入规则：准备/启动中的运行目标允许显式 Stop；停止目标执行中只提供检查而不重复 Stop 或提前 Start；确认停止后可 Start，Export 还需 desired/observed 均 stopped 且无已知冲突。desired=running 的启动/恢复失败可 Retry，desired=stopped 的失败检查原 Stop，不改回运行。提交期间只锁该对象的重复及冲突入口，接受后释放提交锁，继续遵守未知结果保护与 Core 实际准入。

状态观察未确认 SHALL 与已确认失去运行资格分开：同身份最后确认可用的工作区按 DWUI-002 保留画面并显式标记过期/未确认，而新动作仍受当前控制目标、未知锁、能力和服务端准入约束。仅一次读取失败不能等同 Stop、Delete 或身份撤销；已接受停止目标仍立即限制新的运行/文件写入，不能用保留画面回退该规则。

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

#### Scenario: 观察错误和停止目标不同
- **WHEN** 同一 Ready Work 先遇到暂时状态 GET 失败，后取得新的 Stop accepted
- **THEN** 前者保持视口并提示未确认，后者按停止目标限制能力；旧状态读取晚到不能重新开放运行

### Requirement: 生命周期观察与对象刷新独立收敛

**Identifier:** DWUI-017

Desktop SHALL 将原 Operation 状态查询、Work 元数据确认及必要的列表同步作为可分别成功或失败的只读步骤。自动观察、Check status、Operation 详情检查和恢复查询 SHALL 使用相同的结果处理规则；进行中的当前身份已知生命周期操作 SHALL 在列表与面板持续取得 Work 状态，而不是只在 Operation 终态后刷新。

Operation 达到 succeeded/failed/superseded 后，Desktop SHALL 继续完成所属 Work 的确认及必要列表同步；后续读取失败 SHALL 保留操作终态，显示 Work status not confirmed 或列表未确认及 Check status，不把读取失败改成操作失败，不丢失同步义务。读恢复成功后 SHALL 同时收敛状态和按钮；不得依赖用户整页刷新。手动查询先发现终态也 SHALL 触发同样同步。确认 deleted 的 Work 可经当前列表和既有对象读取缺失收敛，不把合法移除写成创建失败。

用户清空本地已完成操作历史时，Desktop SHALL 独立保留尚用于 Work/列表同步的原 Operation ID、已确认终态及其接受代次。移除历史展示 SHALL 不使已确认的原操作重新成为未决，不使 Work 永久停在 accepted 或保持错误的能力禁用。同步确认后 SHALL 依据匹配的终态解除对应接受意图并释放协调记录；旧代次的历史清理 SHALL 不解除新的控制目标或未知修改保护。

读取暂时失败 SHALL 有有界只读重试，耗尽后有显式恢复入口；鉴权失败进入既有登录恢复，明确 404/410 停止该 ID 的无限观察并保留可读原因。一个对象查询缓慢 SHALL 不阻止其他对象更新。隐藏页面停止周期读取，返回可见页面时确认当前事实；关闭详情或离开 Work 不取消远端操作，Works 列表仍观察所属已知操作。暂停原 Operation 观察不得取消远端执行或暗中重提请求。

进入 Works 列表、从 Work 返回列表以及列表重新可见时 SHALL 主动执行一次去重的后台列表确认，不依赖本页是否已知生命周期 Operation。SHALL 提供轻量 Refresh Works 与最后可靠确认信息；刷新保留已有行和当前搜索，成功空集合与读取失败分开。后台刷新不产生成功流水、不触发业务控制，保持既有并发、排序、身份隔离和失败恢复边界，不承诺跨窗口实时推送或高频全量轮询。

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
- **THEN** 可见后从原身份及 ID 确认事实，列表中仍可找回活动操作；暂停/关闭/恢复本身不重放业务修改或发送远端取消；已明确授权的导出意图可在用户 Resume、核对原结果并满足前置条件后，按 DWUI-009 继续尚未提交的下一阶段，不把它当成原未知 POST 的重试

#### Scenario: 缺失对象、读取失败与空列表
- **WHEN** 列表读取成功为空、列表读取失败，或原 Delete 操作仍可查而 Work 不再存在
- **THEN** 分别显示真实空态、保留旧列表及读取恢复、或原 Delete 进度；不得以读取失败制造零 Work 或丢失 Delete 身份

#### Scenario: 外部变更后返回列表
- **WHEN** 另一授权客户端新增/删除/停止 Work，而本页没有对应已知 Operation，用户返回 Works 或重新使列表可见
- **THEN** 发起一次合并列表查询并更新真实结果，保留搜索和可读旧内容；没有整页重载或生命周期 POST

#### Scenario: 列表刷新失败后重试
- **WHEN** 返回 Works 的列表读取失败后用户点击 Refresh Works
- **THEN** 旧列表与最后确认信息保留，局部错误可恢复；成功才更新行/空态，没有后台成功提示堆积

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。用户显式 Refresh/Check 且结果未变化时 SHALL 在原刷新/检查入口附近给一次 Refreshed / Up to date 等简短确认，不新增通用 Checked/Confirmed 条；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

Work 列表、Work、Services、Files、Settings、Session、详情和深链接首屏 SHALL 按同一规则呈现；进入路径本身不要求用户先点击检查。已有内容更新 SHALL 保留可读内容和取得时间，首次读取无数据时显示真实骨架，成功空集合才进入空态。后台读取不得插入通用 pending 条；需要影响准入的真实降级或不可达 SHALL 仍在所属模块持续呈现。
轻量状态、工具栏和选择反馈 SHALL 不让用户正在连续操作的命中目标无故移动；Files 从零选中到有选中及清空选择时，列表起点和对应行的选择目标位置保持稳定。同一服务的临时状态观察失败按 DWUI-002 保留实际视口，不能用整体替换状态页达到提示错误的目的。

受影响界面的完成与警告 SHALL 使用既有语义色、图标和简短文字，不重复输出同一结果的标题、长说明、状态条和toast。必要风险、失败原因、未知结果与下一步仍可见且可被辅助技术识别，不仅凭颜色表达。Files刷新SHALL固定在原控件显示busy及一次短成功反馈，不增加主区域顶部行；错误反馈不能随正常成功提示定时消失。

Modal footer SHALL 按DUL-007统一同类按钮几何与角色，正文按钮、菜单行保持各自职责。开关 SHALL 即时完成且不使用Modal动画、退场快照或延迟清理，同时保持原模态/非模态、Escape/外部关闭白名单、dirty guard与提交保护；旧异步结果不得影响新对象、新身份或新弹层。焦点恢复一次，背景无遗留遮罩；普通与减少动态效果设置一致。

#### Scenario: 多目录正常读取后不堆积
- **WHEN** 用户在同一 Work 依次打开根目录、apps、子目录，再返回根目录并切换 Services/Chat
- **THEN** 等待有局部读取反馈，完成后内容正常展示，没有 Checked/Confirmed 加 ISO 时间的状态条，没有跨目录成功记录堆积或背景读取 toast

#### Scenario: 手动检查未变化
- **WHEN** 用户显式刷新目录或检查 Work，成功结果与已有内容相同
- **THEN** Files/Chat普通读取在原控件结束等待并恢复普通状态，不新增成功条或toast；其他显式检查保持已有简短确认；失败时有可操作错误而非成功措辞

#### Scenario: 写入成功、未知结果及读回失败
- **WHEN** Save 已确认、修改响应丢失，或原操作已确认而对象刷新失败
- **THEN** 分别提供简短保存确认、持续的未知核对入口、或确认结果与刷新未确认说明；短提示到期不改变提交保护或重放任何修改

#### Scenario: 详情关闭与应用稳定
- **WHEN** 进行中的生命周期详情关闭、反馈到期，或状态刷新时当前 Service 有未保存输入
- **THEN** 原 Operation 从所属 Work/已知操作仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用

#### Scenario: 文件多选反馈不推移目标
- **WHEN** 用户连续勾选 Files 中多个文件并取消最后一个选择
- **THEN** 操作反馈可辨且同一视口的列表起点/行选择目标不因工具栏出现消失而跳动，文件名打开与选择互不混用

#### Scenario: 文件刷新不产生额外成功行
- **WHEN** 文件刷新快速成功、慢响应、结果未变化或失败
- **THEN** busy在原图标按钮呈现、成功恢复普通图标且目标几何稳定，无重复成功toast；失败/未知仍有对象及安全下一步，不伪造成功

#### Scenario: 即时关闭与异步结果竞争
- **WHEN** 关闭时旧请求返回、立即重开另一弹层、切换身份/导航，或使用减少动态效果
- **THEN** 旧展示只清理原对象且不接受重复提交，新弹层和焦点不被旧回调清除；关闭最终无backdrop/inert残留，Export继续非模态交付

#### Scenario: Files缓存与首次读取的作用域
- **WHEN** 当前目录首次读取、缓存空目录背景读取、已有文件刷新或读取失败，而其他目录已有缓存
- **THEN** 按当前Work和目录区分静态占位/已确认内容/局部错误，保留工具栏、选中和滚动，不以其他目录缓存制造假空态；重试不重放未知写入

#### Scenario: Chat普通读取与执行状态分离
- **WHEN** 会话列表或历史背景读取、首次读取、失败重试，或activeRun首次检查
- **THEN** 原历史、草稿和阅读位置保持，普通读取无时间戳/通用状态行；初次静态占位，错误一次局部呈现与重试；activeRun真实loading在发送控制中性表示、发送仍按未确认锁定，失败/闲置未确认保留Check status，真实Run/断连/unknown提交不被隐藏

#### Scenario: 合法多入口与Desktop图标
- **WHEN** 用户切换服务、在详情选择多入口，或打开Desktop页面
- **THEN** Service主Header与选择器不展示端口，详情保留技术信息和合法入口选择；iframe及独立窗口路由与所选真实端口一致，favicon使用既有Piwork PNG并通过嵌入资源交付
