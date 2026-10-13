# Chat 控制与 Service 请求入口验收

2026-10-12，在独立开发安装执行 `improve-chat-controls-and-service-visibility`。运行环境为 Linux、Go 1.25.5、Node 24.20.0 和 Playwright Chromium。模型为 acceptance Agent 的合成确定性模型，未使用真实模型凭据。结果证明交互与执行契约，不代表任意模型的业务判断质量。

## 首轮实际结果

- Service 从零记录开始隐藏入口，首条真实 `agent.requested` 事件被 Agentd 接受后出现 **Agent requests**；可查看并取消原请求。第二条 Service 请求通过 Main Chat 的 **Stop and send** 取消，两个请求最终均 cancelled，各只有一个原自动 Run，没有续接。
- 另一个用户 Session 的真实 Run 被停止，当前用户 Session 接受唯一新 Run；原提交键只读查询指向该新 Run。未遍历其他 Session 的聊天历史。
- acceptance 专用扩展故意等待 SDK shutdown，不响应 Run 的取消。浏览器组合请求在 **5067 ms** 返回 `CANCEL_TIMEOUT`（含 HTTP/浏览器开销）；旧 Run 保持 cancelling 和原活动槽，草稿保留。释放扩展后旧 Run 才变 cancelled；等待一个正常刷新周期后，原新消息键仍 not-found，没有迟到补发。
- 完整 `.work` 导出、上传、导入后得到 stopped Work；显式 Start 后旧取消终态、新成功 Run、已接受键映射均保留。携带原取消目标重放已接受键返回原 Run/reused，不执行模型；超时未接受键仍不存在。Service 请求变为 historical/cancelled，不参与自动处理。
- 本轮真实安装最终 containers/networks/volumes 均为 0。清理仅按该安装的精确标签执行。候选 Agent 为本地 `piwork-agentd:chat-controls-acceptance`；没有推送镜像或发行。

联调还发现并修复了宽屏辅助 Chat 的观察范围，以及取消按钮消失时 Check status 被复用成 Close 的节点身份问题。动作和显式目标在发布本地反馈前捕获，按钮按动作及对象身份保持；浏览器回归验证状态变更后原 Check status 节点仍对应原动作。

## 首轮验证入口与边界

| 检查 | 结果 |
| --- | --- |
| contracts 单元及 protobuf/HTTP 可选字段契约 | 39 通过；原 chat controls v1–v3、文字/图片限制保持 |
| Agent cancel-and-send、runs、brain-flow | 51 通过，包含旧执行实际收尾、同键并发、后台竞争、不同 Work 并行和恢复 |
| Go contracts、agentclient、coreapp、cli、workhistory | 对应包通过；CLI 下载进度用例首轮出现计时失败，单独复测及整个 CLI 包复测通过 |
| work-store 单元与冷历史 | 62 通过；Go workhistory 校验 schema 4/5、Memory 与历史重建通过 |
| Desktop 完整浏览器回归 | 264 通过，1 个既有五分钟票据过期长时测试跳过；无失败 |
| 真实 Go Core → TS Agentd → Go Desktop/浏览器 | 查看/取消、跨 Session/Service 交接、受控超时、完整包往返通过 |
| make generate | 重跑后的既有生成产物摘要完全一致，无历史 schema 变更 |
| make build-cli、嵌入资源、native boundary、OpenSpec strict、diff | Linux/Windows CLI 构建、嵌入资源一致性、native boundary、OpenSpec strict 与 diff 检查通过 |

初轮并行浏览器进程出现 Node 原生断言退出，改为串行执行；另一次应用登录等待失败单独复测通过。最终完整回归单独记录，不将失败轮次计为通过。正式 Chrome/Edge、Windows 实机、真实提供商网络断线以及旧 schema-4 Agent 的完整升级实验未在本次追加执行；schema 4 兼容由现有冷历史校验验证。取消不承诺强制终止任意工具，也不撤销已经提交的业务 Job 或数据。

## 首轮新增 Scenario 对照

A 为 `apps/agentd/src/cancel-and-send.test.ts` 及既有 runs/brain-flow；G 为 agentclient、Core 所有者路由和 Desktop 代理 Go 测试；B 为 Desktop recovery/feedback/browser 测试；R 为 `test/chat-controls-real-core.mjs` 的真实链路；H 为 Go workhistory 与 work-store 冷历史测试。下面只列本 change 相对主规格新增的 29 个 Scenario。

| 规格 | Scenario | 实际验证 |
| --- | --- | --- |
| CONV-CANCEL-SEND-001 | 取消其他 Session 或 Service Run 后发送 | A、B、R；独立 Work 用独立 store/harness 并行 |
| 同上 | 校验失败与越权目标 | A 非法输入/Session/context/目标不取消；G 所有者和响应范围；B 空输入/命令/IME |
| 同上 | 旧目标完成或被另一个执行取代 | A 完成/占槽竞争；B busy 保留草稿并只读更新目标 |
| 同上 | 取消等待超过五秒 | A 假时钟 4999/5000 ms；R 实际 SDK shutdown 阻塞与迟到收尾 |
| 同上 | 后台和多窗口竞争 | A 同键合并、异键冲突、最终模型核对期间自动/普通提交不可抢槽 |
| 同上 | 幂等重放与取消目标变更 | A、G 契约及摘要；R 原键查询与导入后的原键重放 |
| 同上 | 新消息未受理或已经受理时断线 | A 受理前 signal 中断及进程恢复不补发，受理后 signal 不影响执行；B 丢回执只读核对 |
| 同上 | 取消期间生命周期或设置变化 | A drain/context/model/binding 变化阻止受理，完整设置和图片快照保持 |
| 同上 | 旧客户端与完整包历史 | A、G 缺省能力/旧摘要；H schema 4/5；R 终态和原键完整包往返 |
| DUL-002 | 有记录才显示 Service 请求入口 | B 空集合、首条、terminal/historical；R 真实首条与原位置 |
| DUL-002 | 从 Service 入口查看再返回 | B 过滤、分页、阅读位置、焦点、草稿与 iframe；R 原页面状态保持 |
| DUL-002 | 专注和窄屏中的请求入口 | B 360px、Focus/Hide chat/Exit focus 可达，无额外页面 |
| DUL-002 | 读取失败不伪造空态 | B 初次未知、已存在后 503 和页面隐藏停止读取 |
| DUL-012 | 明确停止旧 Run 后发送 | A、B、R；保持原用户 Session，原按钮绑定明确目标 |
| DUL-012 | 导航与网页命令不取消 Run | B 既有五个网页 slash、IME/Shift+Enter、布局和关闭行为 |
| DUL-012 | 正文简化且执行依据仍可查 | B 无正文 ID 列表，参数化历史 Run details 不替换观察对象 |
| DWUI-004 | 当前 Work 的其他 Session 或 Service 占槽 | B 三种来源；R 跨 Session 与真实 Service Run |
| DWUI-004 | 无效新消息不影响旧执行 | A 输入/图片/模型/Thinking/命令/context；B 无写入断言 |
| DWUI-004 | 取消等待超时且旧 Run 随后结束 | A、B、R；旧槽保留、草稿保留、没有补发 |
| DWUI-004 | 目标变化和完成竞争 | A 保留终态且不误停新目标；B 原目标字段及 busy 只读恢复 |
| DWUI-004 | 接受响应丢失与后续编辑 | B 同原键 GET、文字/图片后续编辑保留；A 设置快照 |
| DWUI-004 | 原能力降级与历史详情 | G 旧 Agent 不收到组合参数；B 旧聊天恢复、历史模型/来源按需读取 |
| DWUI-FEEDBACK-001 | 空 Service 后收到首个请求 | B 有界 limit=1/5 秒可见刷新；R 真事件后入口出现 |
| 同上 | 只有终态或导入历史 | B 保留入口、禁用取消/新增 Retry；R 导入历史不续接 |
| 同上 | Service 范围和晚响应 | B Service A/B 晚响应、端口共用范围、身份切换清理 |
| 同上 | 请求回复和 Main Chat 保持独立 | B 只读原 runIds、无自动 Session 全历史请求、草稿和 iframe 不变 |
| 同上 | 取消等待或正在处理的请求 | B pending/waiting/running/cancelling；A 原 Job 引用保持；R running 实际收尾 |
| 同上 | 取消回执或查询失败 | B 丢取消回执、503、Check status 和原对象锁；不自动重发 |
| 同上 | 只读详情关闭与专注布局 | B 返回列表/焦点/阅读位置、360px、节点身份；R 同一 Service 文档保持 |


## 核验修订后的补充验收

首轮自动检查通过后，独立核验发现 W1、W2、W3 和 S1；上面的首轮事实保留，不能据此认为这些边界当时已通过。2026-10-12 本轮补齐实现并重新验证，代码基于 8b49c2c 的 dirty 工作树，没有提交、发布或切换 tmux 32。

| 核验问题 | 本轮行为及实际证据 |
| --- | --- |
| W1：刷新失败清空已确认回复 | 每个原关联 Run 分别保留回复、实际设置和最后成功读取时间。浏览器覆盖首次失败、成功后 503、部分失败、恢复成功、关联改变及身份晚响应；真实自动 Run 回复读到后，仅在浏览器读取边界注入 503，原文与时间仍可见，恢复后错误消失。 |
| W2：后台活动覆盖当前 Chat 错误 | 活跃槽控制目标与用户 Session 反馈分开。浏览器覆盖失败和观察中断；真实 SDK 扩展令用户 Run 失败，再启动另一个 Service Run，原错误仍可见，Check original Run 绑定失败 Run，Stop and send 绑定后台 Run。 |
| W3：未知 Retry 缺少原键核对 | 复用既有 retry:键、原请求摘要与 retryOf，只读 RPC/GET 返回 accepted/not-found。真实 Core/Agentd 接受 Retry 后丢弃本地回执，界面只发一次 POST、一次原键 GET，定位同一新请求；原 Retry 的合法阶段已完成后比对请求集合和 runIds，查询没有额外写入。 |
| S1：列表取消停在 cancelling | 真实 SDK shutdown 暂不收尾，列表先显示 cancelling；释放后正常只读刷新更新 cancelled。浏览器覆盖丢回执、读取失败、关闭/隐藏与返回、完成竞争，过滤/分页/焦点/草稿和 iframe 保持。读取错误按原请求保存，另一条成功读取不会清除它。 |

本轮真实链路继续通过跨 Session/Service 的停止并发送。取消等待为 **5083 ms**（含 HTTP/浏览器开销），返回 CANCEL_TIMEOUT 后旧槽仍被占用、草稿保留；旧执行实际收尾后原新消息键仍 not-found，没有补发。五条 Service 来源记录包含原取消请求、显式 Retry 及其原请求，查询不会额外创建记录。

完整包往返通过：导入先 stopped，显式 Start 后原 Run 终态、已接受 Run 键及未受理键状态保留；原 Retry 键在新 Work 范围仍定位同一 requestId/retryOf，返回 historical，错配原请求被拒绝，historical 不能发起新 Retry。历史请求不参与自动处理。schema 5、既有 schema 4 和摘要规则未改变；冷历史及重新打开存储的只读核对同时通过。

| 本轮检查 | 实际结果 |
| --- | --- |
| contracts / protobuf / HTTP DTO | 40 通过；新增通用 RPC 信封、键限制与安全投影，原可选能力保持。 |
| work-store + Agent cancel-and-send/runs/brain-flow/application | 119 通过；包含只读查询零 wake/零提交、原 Job/Action 规则、SQLite data_version 不变及冷历史读取。 |
| Go contracts、agentclient、coreapp、cli、workhistory | 对应完整包通过；另行复查 Desktop 非法查询，旧 RPC 不支持与原作用域校验。 |
| Desktop 全部浏览器回归 | 274 通过、1 个既有五分钟票据长时用例跳过，无失败。随后两处反馈范围调整，通过最终构建资源的 24 项定向复查。 |
| 旧组件与未知 Retry | 追加定向用例通过：旧 Core 404、旧 Agent 501、not-found、错配 Work/retryOf 均保留原键及未知；恢复一个意图不清除另一意图。 |
| 构建与一致性 | make build-cli 完成 Linux/Windows amd64；make build-go、8 份生成产物重跑摘要一致、浏览器/public 嵌入资源逐文件一致、native boundary 和 diff 检查通过。 |
| 真实 Go Core → Agentd → Desktop | 真实请求/Run/SDK 收尾、浏览器 503/丢回执、原键核对、五秒超时及完整包往返通过；最后安装 containers/networks/volumes 均为 0。 |

本轮使用本地 acceptance 镜像 piwork-agentd:chat-controls-recovery-acceptance，实际 image ID 为 sha256:de682693e707c3155029bd21e97272afdc98a0dd7e2c168d50f91936110c594c。只构建本地制品，没有推送或发行。

失败轮次没有计入成功结果：一次测试在轮询启动后才接管浏览器时钟；一次原测试仍要求未知 Retry 再次 POST，与修订规格冲突；真实夹具的服务器端 route.fetch 无法解析 desktop.localhost，改为本机连接并保留原 Host/Origin，捕获夹具错误后交还主测试清理。该失败安装按精确标签清理，容器/网络/卷也均为 0，随后完整真实链路重跑通过。

原 Job 保留由 Agent 的受控 Action/Job 流程测试核对；本轮真实 Service 夹具未新增业务 Job，不声称已验证任意应用的事务撤销。Windows 只完成构建，未追加实机运行；旧组件降级使用协议和浏览器夹具，schema 4 兼容使用冷历史校验，没有另做旧 Agent 镜像完整升级。真实模型提供商网络故障仍不在本轮范围。

### 本轮新增九个 Scenario

以下与首轮 29 项对照合并，覆盖本 change 相对主规格新增的 38 个 Scenario。B/G/A/H/R 的含义沿用上文，R 仅指本轮实际覆盖的链路。

| 规格 | Scenario | 实际验证 |
| --- | --- | --- |
| DUL-002 | 回复读取失败后仍可阅读最后确认内容 | B 首次/保留/部分失败/恢复；R 真实回复后浏览器 503。 |
| DUL-012 | 后台活动不覆盖当前对话错误 | B 用户失败/观察中断；R 用户真实失败与后台 Service 并存。 |
| DWUI-004 | 后台活动与当前 Chat 错误并存 | B 原对象 GET 不替换活动槽/观察；R 原失败 Run 与停止目标分别核对。 |
| DWUI-FEEDBACK-001 | 已确认回复的重新读取失败 | B 保留原文、实际信息和时间；R 503 后恢复。 |
| 同上 | 多个关联 Run 部分读取失败 | B 各项独立合并、关联改变及 in-flight 晚结果过滤；不读取其他 Session 全历史。 |
| 同上 | Retry 核对尚未确认或旧组件不支持 | B not-found/404/501 保留原键和锁；G Unimplemented 明确返回不支持。 |
| 同上 | Retry 核对范围失配或晚响应 | B Work/retryOf/身份晚响应和无关意图保持；G 原 Work/requestId/key、H 原摘要关联。 |
| 同上 | 列表取消跟踪真实终态 | B 原分页合并/读取失败；R held shutdown 到真实 cancelled，iframe 保持。 |
| 同上 | 关闭列表停止收尾观察 | B 关闭后原 ID 周期读取停止、返回恢复且仅一次 Cancel；共用隐藏/恢复观察规则。 |

### 其余既有 Scenario 的本轮核对

下面 22 项与上面 38 项共同覆盖修订 artifacts 中的全部 60 个 Scenario，不把受控测试标为真实业务应用验收。

| 规格 | Scenario | 实际验证 |
| --- | --- | --- |
| Limit active execution per Work | Concurrent sessions in one Work | A runs/cancel-and-send 同 Work 排他、异键竞争，无隐藏队列。 |
| 同上 | Separate Works run concurrently | A 两个独立 store/harness 的 Work 并行。 |
| DUL-002 | 有可用 Service 的 Work | B 正常工作区；R 默认应用与辅助 Chat。 |
| DUL-002 | 空 Work 或 Service 不可用 | B 空/不可用 Service 的 Chat 与恢复出口。 |
| DUL-002 | 从 Service 聚焦对话再返回 | B UX Focus/Restore 保持 Session、草稿和对象。 |
| DUL-002 | 查看详情后返回 | B 原列表/对象、焦点和阅读位置。 |
| DUL-002 | 从应用查看自动处理依据再返回 | B 请求详情及证据；R 同一应用 iframe/草稿。 |
| DUL-002 | 专注应用后恢复工作区 | B Focus/Hide chat/Exit focus，无执行副作用。 |
| DUL-002 | 专注后聚焦聊天仍可退出 | B Restore 与 Exit 分别恢复原布局。 |
| DUL-002 | 从 Files 放大 Chat 后恢复 | B Files 草稿及普通 Chat 与 Focus 的返回路径。 |
| DUL-012 | 跨 Session 遇到忙碌 | B busy 保留草稿；A 活动槽排他；R 显式交接。 |
| DUL-012 | 观察连接丢失 | B 原 Run/游标恢复及观察错误；A 断线不取消执行。 |
| DUL-012 | 取消与成功竞争 | A/B 保留真实终态，不强制改为 cancelled。 |
| DUL-012 | 处理记录与模型执行区分 | B waiting_result 与 Run 来源/详情；A 原 Job 等待释放槽。 |
| DWUI-004 | 忙碌时保留输入 | B 原草稿与显式停止目标；无排队 POST。 |
| DWUI-004 | 断线与游标过期 | B R3 原历史恢复/去重/退避；无重复 prompt。 |
| DWUI-004 | 取消与成功竞争 | A/B cancelling 后读取真实 completed/succeeded。 |
| DWUI-004 | 等待请求不是活跃 Run | B 请求等待与空闲槽；A 原 Action/Job 等待规则。 |
| DWUI-004 | 取消范围可辨 | B Cancel run/Cancel request 原对象；A 请求后续不续接；R Service 请求收尾。 |
| DWUI-FEEDBACK-001 | 查看一次异步处理的闭环 | A 受控 Action/Job 等待、验证/证据、结果及历史；H 关联校验。 |
| DWUI-FEEDBACK-001 | 重试响应丢失 | B 原键只读查询与精确意图/锁；R 受理后丢回执，一次 POST、一次 GET、新请求不重复。 |
| DWUI-FEEDBACK-001 | 导入历史不参与自动处理 | H 冷历史/已知 schema 4/5；R 五条 historical 记录与 Retry 原键读取，不产生自动 Run。 |


## 2026-10-13：仅修复分页晚响应 Warning

再次核验的 Warning（证据分页晚响应覆盖终态）已修复。范围仅为 adapter 的证据分页合并、对应浏览器回归与资源构建；Stop and send 初始化时序的 SUGGESTION 未纳入。上面的既有验收记录和独立核验发现保留，不能改写为当时已通过该边界。

More evidence 返回后取得原请求的当前缓存，只合并证据项及分页游标，保留当前请求投影、确认时间、读取错误和回复关联；重复证据保留当前已确认项。分页不修改取消收尾观察标记，不以旧 runIds 再读取或过滤回复。身份、Work 和视图代次校验仍在合并前生效。

正式浏览器回归先固定并发时序：取消请求为 cancelling → 旧证据页响应延迟 → 原 ID 状态读取先确认 cancelled → 旧页返回 → 返回原列表并经过六秒刷新周期。修复前即时缓存断言失败，实际为 cancelling，证明测试能捕获回退而不会被随后轮询纠正掩盖；修复后通过。

| 本轮检查 | 实际结果 |
| --- | --- |
| 正式新增分页回归 | 4 通过：终态及原列表上下文保持；当前回复、读取错误与新证据保持；视图晚响应丢弃；身份晚响应丢弃。 |
| 受影响 Chat/Service 请求回归 | 28 通过，无失败或跳过；保留已有查看/取消、Reply/Retry 恢复、停止并发送及历史详情规则。 |
| 最终构建资源复查 | 重建后的 4 项新增分页回归通过，未用旧资源结果替代。 |
| 原独立 Warning 探测 | 原受控探测通过；详情、列表和返回后的列表均 cancelled，观察标记为 false，返回并经过六秒后原 ID 新增读取数为 0。终态保持通过证据合并实现，没有重启轮询掩盖旧状态。 |
| 动作与页面上下文 | 正式回归只有一次 Cancel、没有新 Run；原两页请求缓存、Service 过滤、焦点、精确阅读位置、Main Chat 草稿及同一 iframe 保持。 |
| 构建与一致性 | make build-cli 完成 Linux/Windows amd64，make build-go 通过；browser/public 与嵌入资源逐文件一致，CLI 输入 hash 和二进制摘要匹配；native boundary、OpenSpec strict 与 diff 检查通过。 |

原独立探测在当前资源上的结果：

~~~json
{"detail":"cancelled","page":"cancelled","observed":false,"listAfterReturn":"cancelled","readbacksAfterReturn":0}
~~~

本轮新增两项 Scenario 的对应证据：

| 规格 | Scenario | 实际验证 |
| --- | --- | --- |
| DUL-002 | 晚到证据页后返回列表仍显示终态 | 正式分页回归的终态、两页列表、过滤、焦点、阅读位置、草稿与 iframe 断言；原独立探测复查。 |
| DWUI-FEEDBACK-001 | 证据分页与取消终态核对并发 | 旧页延迟、先确认 cancelled、旧页返回的受控时序；请求投影/确认时间/回复/读取错误及收尾标记保持，只追加证据，无重复 Cancel 或新 Run。 |

当前 artifacts 为六条 Requirement、62 个 Scenario，以上两项与此前 60 项对照衔接。本轮使用浏览器合成 HTTP 夹具验证该前端竞态，未追加 Docker/真实模型联调或 Windows 实机运行；没有修改 Agentd、HTTP/RPC 契约、数据库或部署中的 tmux 32。未提交、发布或归档。
