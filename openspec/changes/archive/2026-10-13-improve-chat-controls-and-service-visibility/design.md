# Design

## Context

动机与范围见 [proposal.md](proposal.md)。本设计落实 DUL-002、DUL-012、DWUI-004、DWUI-FEEDBACK-001 与 CONV-CANCEL-SEND-001，不新增产品容器或 Agent Request 状态机。

初轮实现已提供条件入口、全 Work 活跃查询、五秒取消协调和按需 Run 详情。追加核验发现的差异决定本次补齐范围；首轮成功验收不替代这些边界的实现和验证。

下表保留上一轮修订背景，其四项恢复已实施。再次核验的本轮范围只限证据分页晚响应覆盖终态的 Warning：旧页回写 cancelling 时，原 cancelled 确认已移除收尾观察标记，返回列表便不再核对。Stop and send 初始化时序的 SUGGESTION 不纳入本轮。

| 当前位置 | 当前已具备能力与待补缺口 |
| --- | --- |
| Desktop Service 工具栏及原请求列表/详情 | 条件入口与查看/取消已实现；列表取消后仅第一次读回，不持续跟踪收尾 |
| adapter.loadRequestResponses | 按原 runIds 取得回复；刷新失败会以成功子集替换整组，清掉已确认内容 |
| app.agent 的当前 Run 投影 | 全 Work 活跃目标已用于 Stop and send；同一个投影也承接错误显示，会覆盖当前 Chat 原错误 |
| 原 Chat Retry 与反馈存储 | 原稳定键与 retryOf 已持久化；回执未知后只有旧请求读取，缺少原键只读核对 |
| RunManager、BrainLoop 与原存储 | 已有守卫、实际 settled、五秒等待、单槽和取消终止续接；这些已验证契约保持 |
| 现有定向与真实链路验收 | 正常路径、受控超时和完整包往返已通过；追加探测复现上述四项，需修复后重验 |

现行规格的普通提交 busy 规则保留。新增动作是用户明确选择取消某个 Run 的例外路径，不把普通 Send 或导航解释成抢占。现行 CONV-CHAT-HISTORY-001 中的旧格式文字与当前 schema 5/CONV-SNAPSHOT-001 并存，本次不修订该历史遗留差异，也不更改当前支持的历史格式。

## Goals / Non-Goals

**Goals:**

- 在固定的现有 Service 工具栏中，用一个有记录才显示的按钮提供查看和取消。
- 让 Main Chat 在原输入区完成取消旧 Run、确认停止、发送新消息，整个 Work 保持单活跃 Run。
- 将原目标、输入快照、当前身份和原提交键贯穿操作，保护重复点击、晚响应与失败恢复。
- 通过原请求、Run 和幂等记录完成查询；布局、Spec 与验收使用相同位置和行为。

**Non-Goals:**

- 不增加摘要条、计数、状态卡、顶层请求页、第二个 Chat 输入框或 Service 页面 DOM 采集。
- 不增加追问/补充信息、暂停/让位恢复、新请求生命周期、持久待发送队列或交接数据库。
- 不取消整个 Session、Work 或 Service，不撤销已提交业务 Job，不为主 Chat 自动重试原 Service 请求。
- 不做 SDK worker 隔离或强制结束任意卡死工具；本次只限制取消等待。
- 不改普通业务 CLI 的使用方式、模型/图片限制、部署材料、历史格式或发行身份。

## Decisions

### 1. 固定按钮位置，复用列表和详情

在 services 的现有 service-toolbar 右侧操作区插入 Agent requests，顺序为请求入口、原 Focus/访问动作、原 More。360px 下沿现有工具栏换行规则排列，Exit focus 始终可见。仅 Service 与 Service + Chat 专注布局复用同一个按钮；仅 Chat 使用原 Agent 请求入口。

~~~text
Work: My Work                                  Services | Files | Chat
+------------------------------------------+---------------------------+
| Service | Port | Status                  | Main Chat                 |
| [Agent requests] [Focus] [Open] [More]    |                           |
+------------------------------------------+                           |
| Service application                      | Messages / Activity       |
|                                          |                           |
|                                          | Model / Thinking / Send   |
+------------------------------------------+---------------------------+
~~~

不存在已确认记录时只少一个按钮，没有占位。已完成、已取消及 historical 仍显示按钮。Chat 原 Pi requests 全 Work 入口及原 Retry 行为保持；新增 Service 入口只新增查看、取消。共用现有列表/详情组件，记录入口来源和请求范围即可，不复制一套页面或数据模型。

Service 入口默认过滤当前 Work/Service；用户在原过滤器明确改变范围不会改变应用视口的 Service。详情保存原 Work、Service、requestId 及返回列表上下文；关闭详情回原列表，关闭列表回发起入口，焦点、过滤和阅读位置恢复。详情不赋值给主 Chat 的 view.session 或全局活跃 Run 观察对象。

### 2. 用已有查询确认存在与展示内容

adapter 增加小型请求存在性状态，按当前身份 epoch、Work、Service 缓存 confirmed / hasRecords / error。进入可查询的 Service 时立即 GET agent-requests?serviceName=当前名称&limit=1，正常每 5 秒去重刷新；隐藏页面、切换 Service/Work/身份或 Work 不可查询时停止。打开列表已有新鲜确认结果时复用，避免同一范围重复读取。

此查询只判断是否存在，不计算数量，不扫描全量历史；保留既有分页顺序和游标，不扩展列表排序。确认空集合使按钮隐藏；未知初始态不新增空态区域，失败不把已有 true 改成 false。错误与重试沿既有 Service/请求读取反馈及 Chat 请求入口处理，不增加成功 toast 或检查流水。

列表和详情继续调用现有 API。原请求 goal、source、时间、state、result、error 直接使用公开投影。Agent 回复按原 request.runIds 只读取得对应 Run 的 finalText 和真实设置；进行中的回复尚不可取得时明确说明，不必新增流式观察。详情可按需读取既有证据，原 API 也保留直接历史观察能力；不把共享自动 Session 的整个 transcript 当作某一请求的回复。

回复缓存按身份、Work、requestId、runId 保存成功值和最后成功读取时间。一次刷新逐 Run 合并：成功替换该项，失败保留该项最后确认值并记录错误，首次失败才显示未取得；只渲染原请求当前确认关联的 Run。选择逐项合并是为了保留已取得内容，不能用本次成功子集替换整组，也不从共享 Session 补齐失败项。

从列表或详情取消后，复用原请求缓存和 metadata GET 协调收尾；仅在列表/相关详情可见时立即及正常每五秒核对未终态的原记录，按 requestId 合并到现有各分页。收到终态即停止该记录的收尾观察；关闭、隐藏、Work/身份改变停止本地读取，返回时重新读原 ID。失败保留最后确认状态和就地错误/Check status，不重置分页或重发 Cancel。无需新的持久任务、统计列表或请求状态。

证据翻页和请求状态核对承担不同的缓存更新责任。`loadRequest(more=true)` 在响应返回后，先沿用原身份、Work、requestId 和视图范围校验，再取得该请求此刻的缓存，只合并证据项及对应分页游标；不能以发起翻页时捕获的旧详情替换当前缓存。分页响应附带的旧 request、状态确认时间和读取错误信息不回写请求投影，原 state、updatedAt、runIds、result、error 及已确认回复关联继续使用当前值。状态核对仍由原非翻页读取确认并同步到列表。

分页完成不新增、移除或恢复取消收尾观察标记，也不依据旧 runIds 过滤回复。已确认终态且已停止收尾观察时，晚分页只补齐证据，详情及返回列表继续显示该终态；无需通过重启轮询掩盖回退。保留原分页、过滤、焦点、阅读位置、Main Chat 草稿及同一 Service iframe，不增加 API、存储字段、计时器或请求状态。

本轮回归固定以下时序：取消原请求 → More evidence 旧页延迟 → 状态读取先确认 cancelled → 旧页返回 → 返回列表并经过正常刷新周期。断言证据追加成功、详情和列表保持 cancelled、原观察标记保持终态后的状态，只有一次 Cancel、没有新 Run；同时核对当前结果、错误和 runIds 不被旧页替换。

Service 提交和业务处理流程不改动：

~~~text
Service --> Agentd receiver --> Persist request --> BrainLoop --> CoreFlow Run
                                     |
                                     +--> View original request / Run
                                     |
                                     +--> Cancel original request
~~~

读取来自持久收件后的原记录，Go Core/CLI 仍只做代理。未收到的 Service 本地 outbox 不伪装成已接收请求；新增界面不承担投递前生命周期。取消继续调用原 CancelAgentRequest / CancelRun，不新增暂停状态或恢复分支。

### 3. 当前活跃 Run 查询和可选取消参数

新增受保护的 GET /api/v1/works/{workId}/runs/active 及 Desktop 同路径代理，RPC 为 GetActiveRun。返回安全 Run 投影或 run=null；静态 active 路由先于按 runId 的路由匹配。Agentd 从原 work_activity 读取，不遍历或加载所有 Session 历史，查询不产生执行。Main Chat 可见时立即读取并正常每 5 秒去重更新；切换身份/Work后旧响应失效。普通 Send 意外遇到 WORK_BUSY 时再只读更新目标，不自动取消。

Readiness / chat-capabilities 增加独立 cancelAndSendContractVersion=1 能力，保留现有 chat controls v1-v3 解释。缺失表示不支持，不等于无活跃 Run。旧 Core/Agent 的基础准入、普通 Send、Cancel run 和 Service 访问不因新能力缺失失效；前端不向未确认能力的环境发送新增参数。

复用现有 POST /works/{workId}/runs 和 SubmitRunRequest，增加可选 cancelRunId。未携带时完整保留原普通提交路径。新字段经 Desktop Go 代理、Core DTO、agentclient 和 protobuf 传递；文字、图片、模型和输入模式使用原校验与限额，仍返回原 SubmitRunResponse 中的实际 Run。没有单独的 ChatSubmission 表、可恢复发送队列或新的业务事件入口。

取消目标加入新请求摘要，但不塞进模型选择结构或持久 Run 元数据。未携带字段时使用旧摘要算法；携带时在原规范输入摘要上加入旧 Run 身份。现有 submit_idempotency.request_digest 足以记录，不改数据库 schema；原 promptDigest、私有图片 input 和历史快照算法保持。

### 4. 在 RunManager 协调五秒取消与下一次受理

RunManager 增加短生命周期的 Work 内操作守卫与同键 in-flight 映射，不跨 await 持有 SQLite 事务。普通、自动和组合提交都在最终 store.acceptRun 之前检查守卫；只有守卫对应的新提交可以通过，其他提交返回 WORK_BUSY。BrainLoop 在准备自动受理前检查它，最终 RunManager 检查兜底，避免异步模型解析期间穿过守卫。

顺序为：

1. 先查已受理的原 submissionKey；命中先返回原 Run，不再次取消或重新解析设置。
2. 规范化并校验新输入、取消目标与同 Work 归属，解析完整模型/Thinking 组。相同键同内容的并发调用共用同一操作，异内容冲突。
3. 取得守卫并重新确认 Work/实例与当前活动槽。活动 Run 不是明确指定目标时返回 WORK_BUSY；目标已终态且 Work 空闲时直接进入新受理。
4. 调用现有 cancel 并等待 manager.wait 的真实 settled。取消确认等待最多 5 秒，不仅等数据库 state 改成 cancelling。目标若原本已完成，不覆盖其终态。
5. 取消收尾后，再检查 deadline、运行实例、Work 接受执行准入、Session/context 和已选模型有效性。有效才用原输入快照、完整设置组与原 key 接受新 Run，Memory 等仍在该次受理时捕获。
6. finally 释放守卫/操作映射。新 Run 已受理时原活动槽接替保护；明确失败或超时后没有补发回调，旧 Run 迟到收尾只更新它自己的状态。

~~~text
Stop and send --> Validate / original-key lookup --> Guard this Work
                                                        |
                                                Check exact old Run
                                                        |
                                                   Cancel + wait
                                                        |
                                   +--------------------+-----------------+
                                   |                                      |
                              Settled in time                          5s timeout
                                   |                                      |
                           Recheck admission                         CANCEL_TIMEOUT
                                   |                                 Keep draft
                             Accept new Run                       No delayed submit
~~~

5 秒只约束旧执行停止确认；预校验沿原读取超时，供应商首段回复不在该预算内。不调用 drain、不停止整个 Agentd/容器，不提前删除 work_activity。超时若旧 Run 仍 cancelling，活动槽继续保留。对不响应中止的扩展只能显示取消未完成，不能宣称本次提供强制结束能力。

Stop/Apply/Delete关闭准入或运行代次失效时，组合动作不得新受理。连接中断不影响已经受理的新 Run；未受理部分受该次有界操作及当前授权/准入约束，不持久恢复。现有 Core 修改门禁继续生效，组合动作不得锁住整页或阻止合法 Stop。

### 5. 保持输入快照、未知恢复与历史信息

在原 Send 位置切换 Stop and send，附近使用现有 Run 来源提示说明作用对象；显式 Enter 与按钮一致，Shift+Enter 和 IME 保持。五个网页 slash 动作只导航/设置，显示原网页动作语义且不附带取消。旧 Run 已在 cancelling 时可对有效新输入等待它的原收尾，不重复创造取消任务。

adapter 在请求开始前保存旧 Run ID、目标 Session、原 key、文字/图片快照与身份。取消阶段显示 Requesting cancellation；接受后展示实际新 Run。明确拒绝或 CANCEL_TIMEOUT 保留草稿和旧执行可查状态；网络失败/响应丢失保存原 key，通过现有 runs/submissions/{key} GET 核对。未找到映射仍未知，不拿其他 Run 解除锁，不自动重发或改绑当时最新 Run。确认只消费提交快照，等待中后来编辑的内容保持。

移除 agent 渲染中的 run-history 区块，保留原 Run 数据。复用 Run details 对可确认关联的历史 Run 只读查看实际模型、Thinking、来源与错误；参数化详情目标而不改 work.run。旧消息无法关联时不猜测，仍可从 Session 的按需执行详情读取原事实。当前执行、失败和未知提交的原就地反馈继续显示。

当前用户 Session 的执行反馈单独选择原 Run：优先使用该 Session 已确认关联的观察对象与最后执行记录；全 Work 活动槽只用于忙碌说明、Cancel/Stop and send 的目标。两者可能同时存在。当前 Chat 的失败/观察中断/未知反馈保留原位置，核对和详情带明确原 Run ID；不将全局 work.run 指针充当两类目标，不为查看历史启动执行。缺少关联时保持未知，不选择后台 Run 代替。

### 6. 补齐原 Chat Retry 的只读核对

保持原 Retry POST、新键及新请求语义；仅补充响应未知后的读取。采用受保护的 GET /api/v1/works/{workId}/agent-requests/{requestId}/retry-submission?submissionKey=原键，Desktop 使用同路径代理；查询参数保留原键内容并按原长度限制校验。RPC 使用只读 LookupAgentRequestRetrySubmission，沿用 AgentContentRequest/AgentContentResponse 携带安全结构化投影，补齐对应契约和生成产物。

Agentd 在现有 agent_requests 中按 work_id 与既有 retry:submissionKey 查询；核对原请求摘要及返回请求的 retryOf，返回明确的 accepted 或 not-found 快照。结果包含原 Work、原 requestId、原键，以及 accepted 时的新请求公开投影；不改提交摘要、不增表或字段，不调用 retry、取消或 brainLoop.wake。权限、运行实例、Work 可查询与历史准入沿现有读取规则；旧 Core/Agent 不支持时明确保留未知并提示不支持，不用 Retry POST 代替只读核对、不隐式更新镜像。

Desktop 在原 Chat 请求详情的现有 Check status 中核对未知 Retry。暂存意图只含原身份/Work/requestId/键及匹配操作，不是持久发送队列。accepted 必须验证全部原身份和 retryOf，才展示该新请求并解除匹配未知锁；not-found、读取失败、不支持或晚响应均不能清空原键或把原调用判为失败。只读刷新原请求不能确认新 Retry；其他操作的锁不随之解除。Service 入口仍不出现 Retry 按钮或新的重试流程。

~~~text
Explicit Retry(original request, original key)
                    |
             Receipt unknown
                    |
              Check status (GET)
                    |
          +---------+----------------------+
          |                                |
  accepted + matching scope       not-found / error / unsupported
          |                                |
  Show same accepted retry        Keep original key + unknown
  Release matching lock           No Retry POST / no new key
~~~

### 7. 受影响模块和一致性校验

| 位置 | 修改责任 |
| --- | --- |
| proto/agent.proto、packages/contracts/src 的提交/能力契约及生成产物 | 可选 cancelRunId、GetActiveRun、Retry 只读核对契约、独立能力和错误语义；保持旧摘要与图片限额 |
| internal/agentclient、internal/coreapp/conversation.go、feedback_http.go、internal/cli/user_desktop_control.go | RPC/HTTP/本地代理、Retry 只读路由与结果校验、所有者和实例边界、active 静态路由、超时与字段透传 |
| apps/agentd/src/runs.ts、application.ts、brain-loop.ts | 同键协调、守卫、五秒取消、最终受理门禁与当前活跃查询 |
| packages/work-store/src/store.ts、feedback.ts | 复用既有活动槽、取消和幂等；增加既有 Retry 键的只读核对，不加表或状态 |
| apps/desktop-webui/src/app.ts、adapter.ts、models.ts、action-state.ts、public/style.css | 条件入口、复用弹窗、输入区动作、身份隔离、详情目标和现有样式 |
| apps/agentd/src/*.test.ts、packages/contracts/src/*.test.ts、Go 路由/代理测试、apps/desktop-webui/test | 对应 delta Spec 的竞争、超时、空态、返回、输入与旧环境验收 |
| internal/desktopassets/static、docs/desktop-webui.md | 源码构建后的宿主资源与实际使用说明 |

## Risks / Trade-offs

- SDK/扩展不响应取消 → 五秒后返回明确失败并保留旧槽与消息；不把超时当作已停止，不承诺强制恢复。
- 取消已经成功但新输入受理失败 → 展示旧执行真实终态与新消息失败/未知，保留草稿，不自动恢复旧请求。
- 守卫仅在当前进程存在 → 重启按既有规则将旧执行记 interrupted；没有持久待发送消息自动重放，原键查询仍依赖原持久映射。
- 旧环境不认识新参数或 active 查询 → 独立能力确认后才启用组合动作，保留原有手动取消与忙碌恢复。
- 空态隐藏可能错过后来请求 → 无记录时仍按可见性进行最小只读刷新；错误不清除已确认存在状态。
- 请求共享自动 Session、历史关联缺失 → 读取原关联 Run 的回复；无法取得时明示，避免按时间猜测或串入其他对话。

## Migration Plan

1. 先实现可选契约、能力与活跃查询，执行 make generate，同步 TS/Go 产物；用旧请求与旧 Agent 合成测试验证无强制升级。
2. 实现 RunManager 协调与定向竞争测试，再接入 Desktop 的条件按钮、原弹窗和输入区；请求收件、CoreFlow/业务等待及历史 schema 保持。
3. 更新用户说明，构建 Desktop 资源及 Go CLI 宿主，执行相关单元/契约、浏览器与隔离真实链路检查。正常取消与故意不响应取消的超时场景分开记录。
4. 补齐回复保留、当前 Chat 原反馈、列表取消收尾和原 Retry 只读核对；各功能同时落实定向回归及用户说明，再重验集成、构建与原键/历史兼容。不将首轮验收通过写成这些新增边界已经通过。
   对再次核验的分页 Warning，先实施当前缓存上的证据合并并加入受控晚响应回归，再重建 Desktop/Go CLI 嵌入资源和复核原 Warning。其余已实施范围不因这次修订重新扩展，原验收事实不改写为该 Warning 已修复。
5. 回滚时配套回退 UI/契约/协调及生成资源。没有数据库迁移；已取消 Run/请求保持真实终态，不能把代码回滚解释成业务恢复。
