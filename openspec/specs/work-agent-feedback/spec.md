# work-agent-feedback 规范

## Purpose
定义 Work 内 Service 与 Pi 的双向交互，使业务状态、用户操作、Action 和异步任务形成可查询事实，并让明确的处理请求在持久受理后自动执行、验证和回写。成功、等待、取消、失败、中断及环境迁移均有可观察状态，避免未知副作用重放和无边界自主循环。

## Requirements

### Requirement: 发现语言无关的 Service 交互能力

**Identifier:** WAF-001

Pi 开发维护的 Service SHALL 提供版本化能力说明，声明业务状态查询、Action 的输入及结果、对应验证查询、Job 查询、可产生的 Event 和允许请求 Pi 的业务原因。Pi SHALL 通过当前 Work 的 Service 身份及其声明端口解析能力，业务查询和操作在 Work 私网完成；能力说明不得把任意外部 URL、宿主路径或其他 Work 当作当前 Service 端点。

Service SHALL 持有权威业务状态，Pi 与用户页面 SHALL 读取该状态；共享事件和处理进度不形成第二份可任意覆盖业务状态的数据库。无能力说明的外部 Service SHALL 仍可通过既有生命周期、端点和日志使用，不得伪造业务交互能力。

#### Scenario: 发现并操作一个工作站
- **WHEN** Pi 查询已登记工作站的能力并执行其已声明 Action
- **THEN** 使用当前 Work 的真实端点与输入约束，结果可通过原 Action 标识及验证查询核对

#### Scenario: 业务能力缺失或越界
- **WHEN** Service 未提供能力说明，或说明引用越界目标
- **THEN** 前者仅展示真实外部观察，后者明确拒绝该能力；均不猜测按钮行为或调用越界地址

### Requirement: Action 具有幂等身份和真实结果

**Identifier:** WAF-002

每个业务 mutation SHALL 携带稳定 Action 标识与规范化输入；重复同标识同内容 SHALL 返回原操作，同标识异内容 SHALL 冲突。依赖可变业务对象的操作 SHALL 校验预期状态版本，冲突时返回当前可查询状态，不能无条件覆盖用户后续修改。

Action SHALL 区分 accepted、running、succeeded、failed、cancelled；异步 Action SHALL 返回可查询 Job 标识。响应丢失或执行中断后 SHALL 先按原标识核对，不能换新标识盲目重放。状态无法证明时 SHALL 保持未知结果并明确需处理。

#### Scenario: 丢失接受响应后查询
- **WHEN** Action 已提交但 Pi 没有收到响应
- **THEN** Pi 使用原 Action 标识查询或同键核对，Service 不执行第二次业务 mutation

#### Scenario: 用户在 Pi 读取后修改状态
- **WHEN** 用户修改目标状态后 Pi 使用旧版本执行 Action
- **THEN** Service 返回状态冲突，Pi 重读实际状态，不覆盖用户更新

#### Scenario: 异步接受与业务完成不同
- **WHEN** 导出 Action 返回 accepted 和 Job 标识
- **THEN** 导出仍为等待结果，只有实际 Job 终态及产物验证可以证明完成

### Requirement: 持久记录必要事实并共享处理回执

**Identifier:** WAF-003

Pi 开发维护的 Service SHALL 记录页面路径、业务动作、对象标识、声明的操作者类型、状态版本、Action/Job 关联和结果时间；页面路径不得附带表单正文或敏感 query 内容，平台不得通过浏览器外壳采集 DOM、输入、录屏或内存。普通事实 SHALL 不触发模型执行。

Service SHALL 在业务提交时保留对应待发送事件，在取得持久收件回执后确认已发送；传输失败保留事件并按原事件标识重试。Work 内共享记录 SHALL 保存原事实及可关联的 Pi 请求、Run、结果和证据，Service 可按自己的请求标识读取进度和终态。业务内容通过 Service 自己的后端查询，不向浏览器暴露投递或 Agent 凭据。

事件 origin 的 Work/Service 标识 SHALL 表达持久实体归属，与轮换的连接凭据及容器标识分开。原 Work 的同一 Service 重启后 SHALL 使用当前身份投递原 outbox 事件，不改变原 eventId、内容及归属；删除重建的 Service 或导入副本不得以新身份认领原事件。

#### Scenario: 页面访问和状态修改可被查询
- **WHEN** 用户进入复盘页面并完成一个待办
- **THEN** 相关路径和业务动作记录可由 Pi 查询，而页面输入和 DOM 不被自动上传，也不会因此单独启动 Run

#### Scenario: 事件投递暂时不可达
- **WHEN** 业务提交后 agentd 接口暂时不可达
- **THEN** 待发事件保留，恢复后以原标识投递；收件前不显示 Pi 已收到，重复投递不重复记账

#### Scenario: 原 Service 重启后继续投递
- **WHEN** 事件收件前原 Work 的同一 Service 重启并轮换连接身份
- **THEN** 使用新连接身份投递同一持久实体的原事件，仍按原 eventId 去重；源 outbox 不能在另一 Work 或新建 Service 中成为新请求

#### Scenario: Service 展示 Pi 的处理结果
- **WHEN** Pi 完成、失败或等待某个由 Service 发出的请求
- **THEN** Service 用原请求标识取得真实回执并展示业务反馈，不因一次网络断开丢失已持久结果

### Requirement: 明确请求自动进入持久收件

**Identifier:** WAF-004

Service 自动处理 SHALL 只有一种目标入口 `agent.requested`，且必须属于该 Service 已声明的业务原因。系统 SHALL 验证当前 Work、已登记 Service、来源身份及事件生成时的 Work/Service 归属，持久保存后才确认接收。投递者仅能发送自己的事件、读取及取消自己的请求，不得提交任意 Session Run、查询其他 Service 私有回执、更新平台模型或取得 Core 管理权限。

相同来源与事件标识的相同内容 SHALL 返回原回执；异内容 SHALL 返回冲突。本版每 Work 最多 100 个 live 非终态处理请求，单个事件最多 64 KiB；超限返回明确错误且不伪造收件。请求默认接收后 24 小时到期，等待显式 Apply 最多 7 天，截止时间在回执中可查。Service 仅凭事件正文不能扩大 Work 工具权限或已声明目标范围。

#### Scenario: 空闲 Pi 自动处理 Service 请求
- **WHEN** 已登记 Service 发出合法 agent.requested 且 Work ready、空闲
- **THEN** 请求持久接收后自动进入真实 Pi 执行，无需用户再到 Chat 发送相同目标

#### Scenario: 重复、越权和容量边界
- **WHEN** 来源重复投递、重用事件标识发送异内容、尝试读另一 Service 回执或超过容量
- **THEN** 分别返回原回执、冲突、统一不可用或明确容量错误，不产生重复 Run 或越权内容

#### Scenario: 历史环境的待发请求
- **WHEN** 导入后的 Service 试图投递源 Work 归属的旧请求
- **THEN** 请求被识别为历史且不进入 live 自动执行，旧内容保留可查

### Requirement: 单 Work 通过固定流程处理目标

**Identifier:** WAF-005

自动处理 SHALL 沿用现有 Session/Run 契约和单活跃 Run 限制。请求待处理不等于 Run 已接受；Work 忙碌、初始化、draining、Stop 或 Apply 期间 SHALL 不启动自动 Run。满足准入后 SHALL 读取当前真实状态与相关证据，再按目标执行、等待实际结果、验证、回写结果和提交已验证经验。

自动 Run SHALL 使用该 Run 受理时 active 默认模型、有效工具策略、已加载脑包和经验快照，公开 Service 来源、请求与实际 Run 关联。手动 Chat 的模型偏好 SHALL 不改变自动处理模型。每请求最多 4 次自动 Run，每次最多 30 分钟；预算耗尽 SHALL 明确收尾。已执行任务不抢占其他 Run，事实、处理回执及 Pi 自己生成的结果不得再创建新目标。

#### Scenario: 忙碌时等待且可见
- **WHEN** 用户聊天 Run 正在执行，Service 发出处理请求
- **THEN** 请求显示待处理，只有原 Run 释放槽且 Work 可执行后才创建自动 Run，不形成隐藏已接受 Run 队列

#### Scenario: 只处理原目标
- **WHEN** Pi 修改业务状态、生成处理结果和学习记录
- **THEN** 这些事实保留供查询，均不因此触发新的自主改进目标

#### Scenario: 达到自动执行预算
- **WHEN** 自动 Run 超过时限或原请求已经用完 4 次执行预算
- **THEN** 当前执行经取消收尾后释放槽，原请求显示失败或需处理及最后证据，不持续自动重试

### Requirement: 异步结果续接原目标验证

**Identifier:** WAF-006

等待长任务 SHALL 保存原目标、Action/Job/Operation 标识、截止时间及下一步验证条件，释放当前 Pi Run；等待本身不占活跃 Run 槽。匹配的终态事件或固定有界结果核对 SHALL 只推进原目标的验证，不新建同义目标、不重新调用原 mutation。

本版 SHALL 对已登记等待对象每 5 秒最多核对一次，Job 等待期限使用声明值且最多 24 小时；收到终态事实后仍须查询真实结果和产物。超时且无法证明结果、来源被移除或对象不可查询 SHALL 明确需处理，停止自动推进。后续迟到事件可保留为事实，不复活已取消或已终结目标。

未证明业务结果的等待到期 SHALL 统一为 needs_attention/REQUEST_EXPIRED，无论先到的是等待期限、原请求总期限，或二者相等；停机时间计入期限，恢复不得延长期限或重新开启执行。未执行且没有原副作用或等待的 pending 请求到期可以 failed，但不能把这一规则应用到尚有未知业务结果的目标。原 Action/Job、已知事实和业务数据 SHALL 保留，超时不表示业务失败或已撤销。

候选回执查询返回后，系统 SHALL 在推进前重新检查当前目标状态、原 expiresAt 和适用的当前等待期限；首次进入七天 Apply 等待的写入 SHALL 与该检查原子完成。期限等于当前时间 SHALL 视为到期，已有 Apply 等待的轮询不得重设期限。

Action/Job 查询返回后，系统 SHALL 重新读取最新 live 状态、当前等待对象和适用期限；等待续接 SHALL 在同一存储事务内核对当前等待状态、原对象匹配、原 expiresAt 和当前 waitRef.deadlineAt。任一期限 <= 当前时间 SHALL 拒绝续接；仍等待的目标 SHALL 收尾为 needs_attention/REQUEST_EXPIRED，即使回执已报告业务终态。系统 SHALL 保留原对象、等待引用、旧 Run 和业务数据，不创建验证 Run、不增加自动次数、不重放 mutation。先提交的取消或终态 SHALL 保持，historical SHALL 不推进。

期限前合法续接后，原 waitRef SHALL 仅作为该次已满足等待的历史依据，不以旧等待期限误终结已经续接的验证阶段；后续执行仍受原请求期限、预算和生命周期准入约束。显式 Retry SHALL 遵循 WAF-007 的新请求期限与原效果核对，不能把旧请求的等待期限当作新请求的当前等待，也不能复活旧请求。

显式 Retry 对原 Action/Job 的只读核对 SHALL 在每次 Action、Job、capabilities 或验证 Query 返回后重新检查当前 live 状态、生命周期和适用期限，登记原对象等待 SHALL 在事务内使用返回后的当前时刻。原对象仍 accepted/running 也不能跳过该检查；期限相等或已超过 SHALL 当次收尾 needs_attention/REQUEST_EXPIRED，不登记等待、不创建验证 Run、不增加次数或重复 mutation。先提交取消、终态或 historical SHALL 保持。

#### Scenario: 导出运行期间用户仍可聊天
- **WHEN** Pi 已启动导出 Job 并进入等待结果
- **THEN** 该 Run 结束且槽释放，用户能提交其他 Run；Job 完成后自动验证原导出并回写结果

#### Scenario: 完成事件丢失
- **WHEN** Job 已完成但终态事件尚未投递
- **THEN** 对原 Job 的有界状态核对推进验证，不再次提交导出 Action

#### Scenario: 超时与迟到事件
- **WHEN** 等待超过截止时间且结果不可证明，随后终态事件才到达
- **THEN** 原请求明确需处理并保持终态，迟到事件作为事实保留，不自动重开执行

#### Scenario: Job 与请求总期限相等
- **WHEN** Job 等待期限被裁到原请求总期限，二者同时到达且业务结果未证明
- **THEN** 原目标为 needs_attention/REQUEST_EXPIRED，保留原 Job 和最后事实，不因期限检查顺序变成 failed 或启动验证 Run

#### Scenario: 停机跨过等待期限
- **WHEN** Work 在等待期间停止并在期限之后显式 Start
- **THEN** 原目标按原期限收尾为 needs_attention，不延长等待、不重启 Job，迟到结果仍仅作为事实

#### Scenario: 候选回执在原期限前返回
- **WHEN** 准备等待或无 waitRef 的恢复核对取得原候选成功回执，原目标尚未到原请求及适用等待期限
- **THEN** 首次进入七天 Apply 等待，重复核对不延长期限，原提交不重新准备

#### Scenario: 候选查询期间跨过原期限
- **WHEN** 原候选查询在期限前开始，但成功回执恰到原请求或准备等待期限或之后返回
- **THEN** 原目标为 needs_attention/REQUEST_EXPIRED，不重新开启 Apply 等待或验证 Run，原 expiresAt、候选、desired 及旧 Run 历史保持

#### Scenario: Action 或 Job 回执在等待期限前返回
- **WHEN** 查询取得原 Action/Job 可证明终态，返回时原请求及当前等待期限均未到达
- **THEN** 原子续接原目标验证且不重复 mutation；成功续接后保留的旧等待期限不误伤后续验证，原请求期限和执行预算仍有效

#### Scenario: Action 或 Job 查询期间跨过等待期限
- **WHEN** 查询在期限前发起，但终态回执恰到原请求或当前等待期限或之后返回，包括等待期限早于请求总期限及二者相等
- **THEN** 原目标为 needs_attention/REQUEST_EXPIRED，等待续接事务不改为 pending，不新增验证 Run或增加自动次数；原 Action/Job、waitRef、旧 Run 和业务数据保留，不把超期解释成业务失败或撤销

#### Scenario: Action 或 Job 查询期间取消或终结
- **WHEN** 原等待对象的查询返回前目标已取消、先提交终态或成为 historical
- **THEN** 保持先提交状态及原引用，不续接验证、不增加自动次数；迟到回执仅保留原事实，不能重新打开目标

#### Scenario: Retry 原对象在新期限前返回
- **WHEN** 新 Retry 请求查询原 Action/Job，返回时新请求及原业务对象适用期限未到，原对象仍 accepted/running
- **THEN** 只登记原对象等待并释放 Run 槽，使用新请求期限；旧请求等待只作为历史，不重放业务 mutation

#### Scenario: Retry 原对象查询恰到或超过新期限
- **WHEN** Retry 查询在新请求期限前发起，原对象仍运行的回执或能力查询恰到截止或之后返回
- **THEN** 新请求当次为 needs_attention/REQUEST_EXPIRED，不写入 waiting_result 或开启验证 Run，原 Action/Job、旧请求及业务数据保持

#### Scenario: Retry 查询期间取消或终结
- **WHEN** Retry 查询返回前新请求已取消、先提交终态、成为 historical 或生命周期关闭准入
- **THEN** 不登记新等待或受理验证 Run，保持已提交状态及原效果；重新开放准入也不能复活取消/终态/historical 请求

### Requirement: 目标进度与取消都有明确收尾

**Identifier:** WAF-007

请求 SHALL 暴露 pending、running、waiting_result、waiting_apply、cancelling、completed、failed、cancelled、needs_attention 及 live/historical 区别，并保留来源、关联 Run/Action/Job/Operation、最后确认时间、结果、错误和证据。completed SHALL 具有实际业务/产物或能力采用验证依据；Run succeeded 不得直接推导整个业务目标 completed。

所有者 SHALL 能在现有 Chat/详情取消 live 请求；来源 Service 仅能取消自己的请求。取消待处理或等待中的请求 SHALL 阻止后续自动续接，取消正在执行的请求 SHALL 请求 SDK 中止且等实际 Run 收尾；终态竞争保留先提交终态。Cancel run 对关联的未完成请求 SHALL 同样停止自动续接。业务 Job 和已提交数据 SHALL 分别按 Service 实际状态显示，取消 Pi 处理不得冒充业务撤销。

所有者 SHALL 能明确重试 live 且 failed、cancelled 或 needs_attention 的目标；重试以新提交键创建新的关联请求并记录 retryOf，重复同键返回同一新请求，其他终态或 historical 请求不得被原地复活。新处理 SHALL 先核对原 Action/Job/候选的真实结果与当前条件，不复制已有副作用；未知结果仍须需处理，不通过重试规避核对。

#### Scenario: 取消等待中的请求
- **WHEN** 用户取消正在等待 Job 或 Apply 的 Pi 请求
- **THEN** 请求取消且不再自动续接，业务 Job/包 desired 保持自己的真实状态，界面说明其独立结果

#### Scenario: 取消正在运行的自动处理
- **WHEN** 用户通过现有 Cancel run 取消关联自动 Run
- **THEN** Pi 执行实际中止后释放槽，原请求取消，原事件不再次启动 Run

#### Scenario: 完成与取消竞争
- **WHEN** 验证及 completed 已先持久提交，随后取消到达
- **THEN** 返回原完成结果，不覆盖证据或改为取消

#### Scenario: 明确重试未知结果
- **WHEN** 用户重试一个需处理请求并因响应丢失重放相同重试提交键
- **THEN** 只产生一个关联新请求，原请求及证据保持；新执行先查原操作，无法证明时不重新调用 mutation

### Requirement: 恢复与生命周期准入不重复未知副作用

**Identifier:** WAF-008

daemon 恢复 SHALL 保留收件、处理进度、运行关联和证据；旧 accepted/running/cancelling Run SHALL 按现有规则记 interrupted，不自动重放 prompt 或 mutation。同一 Work 中尚未执行且未过期的请求可继续受理；等待已知对象的请求先查询原标识。对于尚未登记等待但已经持久登记原 Action/Job 或候选提交的 live 未完成目标，恢复 SHALL 在正式 ready 后先按原身份进行有界只读核对，不得仅因 waitRef 缺失直接终结可核对目标。

原业务对象已终态可证明且查询返回时原请求及适用的当前等待期限仍有效，SHALL 续接原目标的验证；已登记等待的续接 SHALL 遵循 WAF-006 的事务检查，恢复不能延长或跳过期限。仍 accepted/running 时 SHALL 登记唯一原对象等待并释放执行槽；对象缺失、归属不符、结果不可查询或无可核对效果时 SHALL 明确 needs_attention。候选只查询原提交键的回执及实际采用状态，不重新准备候选。宿主核对 SHALL 不占 Run 槽、不增加模型执行次数；真正接受验证 Run 仍遵循原预算、单槽、让位和兼容 Session。原 requestId、interrupted Run 和副作用标识 SHALL 保留，恢复不是重新执行旧 prompt，也不要求用户重新发送目标。

Stop、Delete 和 Apply 准入 SHALL 同时关闭自动执行入口，初始化候选不得调用模型或推进 live 请求。恢复旧 active 或验证新 active 后仅在当前代次正式接受执行时恢复循环；脑包被禁用或必要能力缺失须明确收尾，不能无限隐藏等待。关闭浏览器、退出登录、Core 观察断线不等于取消已接受处理。

#### Scenario: 在 Action 之后崩溃
- **WHEN** Action 可能已提交而 Run 终态前 agentd 崩溃
- **THEN** 原 Run 为 interrupted，恢复先核对原 Action；可证明的结果进入验证，否则需处理，不重放原调用

#### Scenario: Action 已接受但尚未登记等待
- **WHEN** Action 回执已保存但 waitRef 尚未登记时 agentd 中断，恢复查询证明原 Job 仍在运行
- **THEN** 原 Run 保持 interrupted，原目标登记同一个 Job 的等待，不创建重复 Action，不要求用户 Retry，等待不占聊天槽

#### Scenario: 原操作已完成后恢复
- **WHEN** waitRef 缺失且恢复按原 ID 查询证明 Action/Job 已有终态
- **THEN** 查询返回时原请求期限仍有效才自动进入只验证原结果的执行，否则按原期限收尾；完成仍要求实际验收证据，原 Run 和 requestId 保留

#### Scenario: 原操作无法证明后恢复
- **WHEN** 已登记原操作无法读取、已删除或返回不匹配身份
- **THEN** 原目标收尾为 needs_attention 并保留原引用，不使用新 ID 或原 POST 重新执行

#### Scenario: 恢复核对与取消或期限竞争
- **WHEN** 原目标在恢复核对期间被取消、原请求或适用的当前等待期限到达，或已先提交终态
- **THEN** 不再接受续接 Run，保留先提交终态；仍等待的目标到期为 needs_attention/REQUEST_EXPIRED，即使迟到回执报告终态也不复活目标，historical 同样不推进

#### Scenario: 候选恢复查询期间取消或终结
- **WHEN** 无 waitRef 的原候选恢复查询期间原目标被取消或先提交终态，随后成功回执返回
- **THEN** 保持先提交状态、期限和原引用，不登记新等待、不受理验证 Run、不重放旧 prompt 或重新 prepare；historical 同样不推进

#### Scenario: Stop 与自动受理竞争
- **WHEN** Stop 已关闭准入而循环正准备受理新请求
- **THEN** 不接受新 Run，服务和 Agent 按原生命周期停止，记录保留供原 Work 后续恢复

#### Scenario: Apply 候选初始化
- **WHEN** Apply 使用候选 agentd 做加载验证
- **THEN** 收件历史保留但不调用模型，正式激活且准入开放后才允许续接原目标

### Requirement: 可查询证据与反馈内容保持来源边界

**Identifier:** WAF-009

状态读取、Action/Job 查询和产物检查 SHALL 形成带来源 Service、对象标识、状态/代码版本、取得时间与必要摘要的证据。事实追加与处理状态更新 SHALL 可关联但分开表达；业务状态修改仍走 Service Action。自动及手动执行可在当前 Work 权限内查询相关事实，不得把缺失记录视为「用户没有操作」。

记录查询 SHALL 分页，返回 cursor、取得时间及截断/不可用状态；空集合与读取失败必须区分。公共结果不得包含投递凭据、模型 secret、内部 context digest 或宿主路径。脑包和工具失败只影响对应执行及请求，不自动停止或删除 Work 数据。

请求和 Service 事件分页 SHALL 在读取层按授权范围、过滤、严格游标及页限获取本页记录，不把整个 Work 历史读入应用内存后截取。已完成请求和普通事件数量增长 SHALL 不改变页限、顺序、跨来源隔离及错误语义。此要求不授权删除旧记录或引入新的历史存储服务。

#### Scenario: 根据证据查证完成
- **WHEN** 用户从处理结果打开依据
- **THEN** 能定位实际 Service 状态、Action/Job、业务事件或 Files 产物，并看到取得时间和验证结论

#### Scenario: 空记录与读取故障
- **WHEN** 查询分别返回真实空集合和不可达错误
- **THEN** 前者显示没有记录，后者显示读取失败与最后确认时间，Pi 不用零计数替代故障

#### Scenario: 大量历史按页读取
- **WHEN** Work 存在大量历史请求和多个 Service 的事件，用户以过滤和游标查询下一页
- **THEN** 每页仅取得页限内记录及必要的一条续页探测记录，来源与状态过滤正确，同时间戳边界不重复或遗漏，不一次读入全量历史
