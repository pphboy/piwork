# Tasks

核验修订：W1（已确认回复被清空）、W2（当前 Chat 错误被后台覆盖）、W3（原 Retry 未知缺少核对）及 S1（列表取消不跟踪终态）纳入本变更。受影响任务重新打开，新增只读核对契约/贯通与原 Chat 恢复任务；其余已完成标记保留首轮实现事实，不代表本轮修订已验收。

再次核验修订仅处理“证据分页晚响应覆盖终态”的 Warning（与上轮 W1 回复缓存问题区分）。原 23 项已完成标记保留对应实施与验证事实，不能证明这条 Warning 已修复；新增 3.7、5.4 承接本轮修复与验收。Stop and send 初始化时序的 SUGGESTION 不纳入本轮。

## 1. 可选契约与当前活跃 Run 查询

- [x] 1.1 为 SubmitRun 增加可选 cancelRunId、独立 cancelAndSendContractVersion=1 和 GetActiveRun 契约，补齐 TS/Go DTO、protobuf 与 make generate 产物；以契约/序列化测试验证字段缺省兼容、非法目标拒绝、旧 chat controls v1-v3 及原文字/图片限额不变。
- [x] 1.2 在 Agentd 只读查询原 Work 活动槽，并贯通 agentclient、Core 的 GET works/{id}/runs/active 与 Desktop 代理，保证 active 静态路由先匹配；以 Agent/Go 路由测试验证同 Work 跨 Session/Service、真实空闲、越权/旧实例/不可达与零模型提交，不遍历所有 Session 历史。
- [x] 1.3 贯通 cancelRunId 的本地代理、Core 校验和 gRPC 发送，核对组合操作调用预算与独立能力降级；用 internal/coreapp、internal/agentclient、internal/cli 定向测试验证普通 SubmitRun 不变、文字/图片字段完整透传、旧 Agent 不收到未确认的新参数，Host/Origin/CSRF 与 Work 所有者边界保持。

- [x] 1.4 定义原 Chat Retry 只读核对的查询/结果 DTO、LookupAgentRequestRetrySubmission RPC 与安全投影，accepted/not-found 及原 Work/requestId/submissionKey 关系明确；执行 make generate 并补契约、序列化、非法键和旧客户端兼容测试，原 Retry POST 及 chat controls/cancel 能力不变。
- [x] 1.5 贯通现有请求表只读核对、Agentd、agentclient、Core GET retry-submission 与 Desktop 代理，验证现有 retry:键和原请求摘要/retryOf；定向测试权限/实例/关联错配、缺失映射、历史、旧 Agent 不支持及零写入/零模型/零 wake，不增加存储或用 POST 核对。

## 2. Agentd 取消并发送协调

- [x] 2.1 在 runs.ts 复用并整理新提交预校验和完整设置快照，将指定取消目标加入新请求摘要但保留无字段的旧摘要；用 RunManager/契约测试验证无效文本、图片、命令、模型、Thinking、Session/context 或跨 Work 目标均不触发取消，已受理同键重放先返回原 Run，改目标/内容冲突。
- [x] 2.2 增加 Work 内短生命周期守卫和同键 in-flight 协调，接入普通/自动/组合提交的最终受理及 BrainLoop 准备受理处；用受控执行器测试异步解析期间的后台竞争、同键并发、不同键多窗口和其他 Work 并行，证明只有一次取消及一个新 Run，无隐藏 accepted 队列且不跨 await 持有 SQLite 事务。
- [x] 2.3 复用 cancel 和真实 settled 实现最多 5 秒取消等待，超时返回 CANCEL_TIMEOUT并结束本次新受理意图；用受控执行器/计时器测试 cancelling 保留活动槽、正常收尾后才发送、超时后旧 Run 迟到收尾不补发及失败后守卫释放，不调用 Work drain/停止容器或强制释放旧槽。
- [x] 2.4 在取消与最终受理处重查明确目标、当前实例、Work 准入、Session/context 和已选模型有效性；用竞争测试验证旧目标已终态时保留结果、出现不同活跃 Run 时不误停、Stop/Apply/draining/实例变化阻止新受理，以及等待期间设置变化不混配原完整选择组。
- [x] 2.5 保持 Run 取消关联未完成请求的原收尾、原键查询与恢复规则；扩展 brain-flow/runs 测试验证 Service 请求取消后不续接、Job/数据保持真实状态、接受响应丢失仍只有一个新 Run、断线不取消已受理执行、进程恢复不自动发送未受理新消息。

## 3. Service 请求最小入口与只读详情

- [x] 3.1 在 adapter 增加身份/Work/Service 范围的存在性确认，复用 limit=1 请求查询和可见时每 5 秒去重刷新；以 adapter/浏览器测试验证空集合隐藏、无记录后首条请求出现、只有终态/historical 时仍存在、端口共享范围、页面隐藏停止读取及旧身份/Service 响应失效，失败不伪造空态。
- [x] 3.2 在现有 Service 工具栏右侧、Focus/访问动作之前放置 Agent requests 按钮，复用同类控件及既有专注布局；以桌面、360px、键盘与 Focus/Hide chat 浏览器场景验证有记录才显示，无占位、摘要条、计数、状态卡或新导航，Exit focus 仍可达。
- [x] 3.3 复用原列表/详情和返回上下文，按身份/Work/requestId/runId 逐项合并回复与实际设置、保存最后成功读取时间；失败保留各自已确认内容，首次未取得和部分失败分别说明，仅展示原 runIds。补齐成功后503、部分失败、恢复成功、关联变化与跨身份晚响应浏览器断言，并更新 docs/desktop-webui.md 的最后确认内容说明；无无关 Session 历史或模型提交。
- [x] 3.4 复用 Cancel request 并在可见列表或相关详情立即及正常每五秒去重核对原记录至真实终态，按 requestId 合并原分页缓存，关闭/隐藏停止本地观察、返回只读恢复。测试列表和详情的 pending/waiting/running、迟到收尾、完成竞争、丢回执/读取失败、过滤/分页/焦点/阅读位置及 iframe 不变；同步 docs/desktop-webui.md，明确关闭不撤销取消且不重发 Cancel。
- [x] 3.5 更新 docs/desktop-webui.md 的 Service 请求入口位置、空态、查看/取消、原 Chat 全 Work 入口及历史只读说明；与 DUL-002、DWUI-FEEDBACK-001 和实际界面逐条核对，检查链接及 git diff --check，不另立平行 UI 硬规则文档。

- [x] 3.6 在原 Chat 请求详情保留未知 Retry 的原身份/Work/requestId/submissionKey 及匹配锁，现有 Check status 使用只读核对；accepted 仅恢复对应新请求并解除匹配锁，not-found/失败/不支持保持未知，晚响应不得污染新身份或解除其他锁。浏览器模拟服务端受理后丢回执，断言同键查询、一个新请求、无第二次 Retry POST、原键不被清空；同步 docs/desktop-webui.md，Service 入口仍无 Retry 或补充对话。
- [x] 3.7 修复证据分页晚响应覆盖终态的 Warning：分页返回后仅向原请求当前缓存合并证据及游标，保留最新状态、确认时间、runIds、结果、错误与回复关联，不修改取消观察标记。将受控复现纳入正式浏览器回归：More evidence 旧页延迟、原 ID 先确认 cancelled、旧页返回后再回列表并经过正常刷新周期，断言证据追加、详情/列表终态及原分页/过滤/焦点/阅读位置/草稿/iframe 保持，只有一次 Cancel、没有新 Run；保留原身份与视图晚响应隔离。

## 4. Main Chat 停止并发送及正文简化

- [x] 4.1 在当前用户 Chat 原 Send 位置按真实全 Work 活跃 Run 与独立能力提供 Stop and send，捕获显示中的指定目标并保持用户 Session；浏览器测试覆盖同 Session、其他 Session、Service Run、空闲和旧 Agent，Shift+Enter/IME及五个网页 slash 动作保持原行为，空/非法输入不取消。
- [x] 4.2 在 adapter/send/action-state 中贯通原取消目标、提交键、文字/图片/设置快照和取消等待反馈；用浏览器请求及草稿断言验证一次组合提交、5 秒超时/明确拒绝不自动补发、响应丢失按原键 GET 核对、未知映射不当作失败，以及等待中后续编辑和身份切换不被旧响应消费或覆盖。
- [x] 4.3 移除正文 Run History ID 列表并保留参数化原 Run 详情；分开展示全 Work 活跃目标和当前用户 Session 的执行反馈，后台占槽不覆盖原失败、观察中断或未知提示，核对入口绑定原 Run。浏览器覆盖当前失败/中断与另一 Session/Service 活跃并存、原对象核对、Activity 顺序和历史详情不替换活动观察；更新 docs/desktop-webui.md，不猜测旧关联或新增模型提交。
- [x] 4.4 更新 docs/desktop-webui.md 的 Stop and send、五秒取消等待、原键核对及执行信息所在位置；依据 DWUI-004、CONV-CANCEL-SEND-001 与实际行为校对，明确取消不是暂停且不保证强停任意工具，相关 README 如需变更则中英文同组更新，并执行 git diff --check。

## 5. 跨组件与交付一致性

- [x] 5.1 在新增契约、存储、Agent、Go 代理与浏览器定向检查通过后重建 Desktop、Go CLI 和 internal/desktopassets/static，执行 make build-cli、生成一致性、native boundary 与 diff 检查；核对源码/嵌入资源/宿主界面及旧能力降级，无额外运行依赖。
- [x] 5.2 按 docs/testing.md 的独立安装验证真实 Go Core→Agentd→Desktop：保留正常/受控五秒超时与跨 Session 交接，并补查原回复成功后读取失败、当前 Chat 错误与后台并存、列表取消收尾，以及 Retry 已受理但丢回执后原键 GET 定位同一新请求、核对不额外发起 POST、重复请求或 Run；原 Retry 的合法阶段执行仍按既有规则发生。记录实际层级和结果，保持原 Job、用户草稿与 iframe，不操作其他安装或输出秘密。
- [x] 5.3 以终态 Run、原 Run 提交键及既有 Retry 键完成冷历史和完整包往返检查，验证只读核对的原 Work/原请求/键关系、historical 只读及旧组件不支持时保留未知；保留 schema 5 和已知 schema 4 兼容，无新表/摘要改写/取消复活或补发。补齐本轮全部 Scenario 与核验问题的实际验收记录，保留首轮事实及未覆盖范围。
- [x] 5.4 在 3.7 的受影响浏览器回归通过后重建 Desktop、internal/desktopassets/static 与 Go CLI 宿主，执行 make build-cli、嵌入资源一致性、native boundary、OpenSpec strict 与 diff 检查；复核原分页 Warning 的受控时序并向现有验收记录追加真实结果，核对本轮两项新增 Scenario。仅验证本 Warning 的修复和交付一致性，不纳入 SUGGESTION 的初始化时序优化，不将既有验收结果改写为本轮通过。
