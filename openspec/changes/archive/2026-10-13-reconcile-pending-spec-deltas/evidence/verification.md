# 原三项规格与实现专项核验

起始源码：`93a1ab3fcbfbcb255f6796b0816f7e18d4e49977`。验收时计划文件尚未提交；本轮结果与既有归档分别记录。

范围为原六处 Requirement 的 63 个 Scenario，加 CST-NATIVE-001 四个关联场景。下表 67 项已在本轮 Linux 范围核验通过，各项标注实际验证层级；当前产品契约没有改动。

## 基线

- 45 份主规格及本变更的严格校验通过；文档边界检查通过。
- 已冻结 521 个归档/发行/入口文件摘要，临时基线在 `dist/reconcile-pending-spec-deltas/baseline.json`；原十项未完成任务保持 9+1。
- 初始缺口：410 恢复与后台活跃 Run、匿名 Inspect 与导入命名/未知接受、在途配置 Save 的后续编辑、阻塞控制请求与总关闭预算的组合断言需本轮补核。

## 判定与执行口径

B：浏览器 HTTP 夹具，核对实际请求/DOM/身份/草稿；G：Go 原生路由/进程及存储测试；I：真实 Docker/Core/Agentd 集成。native-auth 浏览器组通过真实本地 Go Desktop API，属于 B/G，不能据此宣称所有 Core 故障都在真实后端发生。测试前缀均指对应现有文件中的命名组，补充 Reconcile 测试单独列出。每个表项同时核对 Requirement 正文；场景计数不替代语义。

本轮运行环境为 Linux amd64、Go 1.25.5、Node 24.20.0、Chromium 140.0.7339.186、Docker Engine 26.1.5+dfsg1 / Compose 2.26.1-4。Windows 只有交叉构建与资源身份核对；其原生安全/控制通道及双平台交付任务仍按原归档保持未完成。

## DWUI-001

合法 HTTP 输入 SHALL 进入原动作的加载、等待、确认或失败状态，不显示“远程必须 HTTPS”的错误或增加确认流程。非法 origin SHALL 保留输入并就地说明格式错误，后端拒绝相应修改。保存响应丢失或提交后未确认 SHALL 沿原只读核对流程恢复，不自动重发。HTTP 与 HTTPS 的 origin 身份不同，切换时 SHALL 按原身份撤销/内容隔离规则处理。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| Core 可达但运行环境失败 | `adapter.checkConnection` | browser: Work lifecycle / D01 status | 通过（B/I） |
| 过期后重新登录 | `adapter.acceptSession + known operations` | native auth: accepted Import survives Core expiry | 通过（B/G/I） |
| 切换 Core 或用户 | `adapter.clearIdentity` | local auth: old access check / preferences remote HTTP | 通过（B/G） |
| 本地授权有效而 Core 会话过期 | `adapter.requestOnce + checkBrowserAccess` | local auth: current business 401 readback | 通过（B/G/I） |
| 本地未授权不能伪装成账号登录 | `adapter.requireBrowserAccess` | local auth: missing Cookie / expired / replayed | 通过（B/G） |
| 登录页面连接远程 HTTP Core | `adapter.switchCore` | preferences: current connection remote HTTP; native HTTP | 通过（B/G） |
| HTTP 默认地址保存并用于重启 | `Desktop preferences + CLI address resolver` | native HTTP; TestDefaultDesktopDispatchAndOriginBoundToken | 通过（B/G） |
| 读取已有 HTTP 偏好及清除 | `adapter preferences clear` | preferences: independent instances; native HTTP | 通过（B/G） |
| 从 HTTPS 切换到同地址的 HTTP | `Desktop origin-bound credentials` | TestDefaultDesktopDispatchAndOriginBoundToken; preferences remote HTTP | 通过（B/G） |
| 协议扩展不放宽本地授权 | `Go Desktop local guards` | TestDesktopPreferencesAPIAuthorizationPrecedesDisk; native HTTP | 通过（B/G） |
| HTTP 输入的失败与未知结果 | `adapter preference submission/readback` | preferences: lost mutation / read failure / late GET | 通过（B/G） |

## WACC-DESKTOP-001

Reset browser access SHALL 经有效浏览器本地会话、精确 Host/Origin 和 CSRF 校验及影响确认，撤销指定 Desktop 全部浏览器授权和派生访问，但保留平台凭证；重签 ticket 不产生该撤销。注销平台身份、重置浏览器访问、CLI 退出均不停止 Work。浏览器访问重置后活动内容流至多两秒断开，旧 Cookie/CSRF/Service 授权不能继续访问，平台上已授予的写入可能已提交，不承诺回滚。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| 任意网站探测本地入口 | `Desktop Host/Origin/CSRF guards` | TestNativeDesktopEmbeddedBrowserAndLocalIdentity; native HTTP | 通过（G） |
| Service 试图借用平台身份 | `Desktop Service bridge credentials` | TestNativeDesktopFilesBridgeUsesCoreWebDAVAndKeepsTokenLocal | 通过（G/I） |
| 浏览器文件与外部 WebDAV 并存 | `Desktop DAV / external proxy` | TestNativeProxyWebDAVUsesCoreBearerAndMapsHrefs; real-core | 通过（G/I） |
| 本地会话失效 | `Desktop content cancellation` | TestDesktopExpiredContentCancelsAndRemovesRegistration; native auth revocation | 通过（B/G/I） |
| 外部主体不能重新签发或清理 | `same-user control endpoint` | TestDesktopControlProtocolBoundsAndPeers; TestDesktopControlDirectoryOwnerAndModeBoundary | 通过（G） |
| 控制通道资源不可信 | `control directory/instance verification` | TestDesktopControlRejectsUnsafeObjectsAndRollsBackHTTP; control stale recovery | 通过（G） |
| 浏览器授权重置与新票据 | `Reset / ticket generation` | TestDesktopBrowserResetKeepsCoreAndCancelsContent; native auth reset | 通过（B/G/I） |
| 容器入口需要本地实例授权 | `container Desktop bootstrap` | TestContainerDesktopStartupHasNoTicketAndControlOpenAuthorizesThisInstance | 通过（G） |

## DWUI-004

事件入口返回 410 后，Desktop SHALL 真正读取原 Run 和对应 Session；只有历史读取成功后才能提示历史已恢复。SHALL 停止向事件入口重发同一失效游标，不擅自用 0 重播。原 Run 仍活跃时 SHALL 展示历史恢复模式，以串行只读查询观察原 Run 和已保存历史；查询到终态后 SHALL 停止自动观察并呈现最终结果，已有输出不得重复追加。读取失败 SHALL 保留已知内容、Run ID 和可恢复提示；鉴权失效或对象不存在 SHALL 停止自动读取并进入对应恢复状态，不能发送新的 Run。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| 忙碌时保留输入 | `send / activeRuns` | recovery: busy submission recovers original Run | 通过（B） |
| 断线与游标过期 | `recoverRunHistory` | R3 expired cursor terminal readback | 通过（B/I） |
| 取消与成功竞争 | `cancelRun` | browser feedback: cancel original Run; Agent cancel-and-send | 通过（B/I） |
| 等待请求不是活跃 Run | `request vs activeRuns projection` | Controls pending/waiting_result cancellation; Agent brain-flow | 通过（B/I） |
| 取消范围可辨 | `request cancellation/detail` | Controls cancelling request / Service detail | 通过（B/I） |
| 当前 Work 的其他 Session 或 Service 占槽 | `send cancel target snapshot` | Controls Stop and send binds sessions; chat-controls-real-core | 通过（B/I） |
| 无效新消息不影响旧执行 | `send admission` | Controls active read failure / empty / unknown / IME | 通过（B/I） |
| 取消等待超时且旧 Run 随后结束 | `send timeout` | Controls timeout preserves draft; chat-controls-real-core | 通过（B/I） |
| 目标变化和完成竞争 | `active target validation` | Agent cancel-and-send completion/target race; Controls target snapshot | 通过（B/Agent） |
| 接受响应丢失与后续编辑 | `submission original-key lookup` | Controls unknown acceptance / later edits; chat-controls-real-core | 通过（B/I） |
| 原能力降级与历史详情 | `optional capability + run details` | legacy Work Agent contract; Controls historical Run information | 通过（B） |
| 后台活动与当前 Chat 错误并存 | `current Chat vs active slot` | Controls recovery another active Run; new reconcile 410 probe | 通过（B/I） |
| 410 后原 Run 已完成 | `recoverRunHistory terminal` | R3 expired cursor terminal readback | 通过（B/I） |
| 410 后原 Run 仍运行 | `recoverRunHistory retry` | R3 active history recovery serial/backoff | 通过（B） |
| 历史恢复失败或身份切换 | `recoverRunHistory identity fencing` | R3 terminal history failure / forbidden/deleted; new reconcile 410 probe | 通过（B） |

## DWUI-007

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| 安装与 Apply 分开 | `package install / applyConfiguration` | browser feedback package acceptance; real-core Save/Apply | 通过（B/I） |
| 忙碌与失败回退 | `configuration active vs desired` | Brain details loaded behavior failure; coreapp apply rollback | 通过（B/I） |
| Apply 期间继续编辑 | `app.saveConfig draft revision` | R2 failed and unknown saves; new reconcile in-flight Save | 通过（B/I） |
| 已加载但未完成脑包验证 | `package candidate projection` | Brain package details; Brain details loaded behavior failure | 通过（B） |
| 候选晚返回与用户新编辑 | `candidate read/desired merge` | coreapp brain candidate tests; new reconcile in-flight Save | 通过（B/G/I） |
| 候选详情包含原验收项与 Apply | `candidate detail projection` | Brain package details / no Apply / observation failure | 通过（B/G/I） |
| Advanced 修改后从其他页签保存 | `synchronizeConfiguration` | R2 Advanced and simple forms complete draft | 通过（B） |
| 普通表单修改后从 Advanced 保存 | `synchronizeConfiguration` | R2 Advanced and simple forms explicit empties | 通过（B） |
| JSON 非法时尝试转换或保存 | `validateConfigDraft` | R2 invalid JSON blocks switching and save | 通过（B） |
| 目录失败后恢复 | `checkCatalog` | R7 catalog errors independent recovery | 通过（B） |
| 目录部分失败及空集合 | `checkCatalog response validation` | R7 catalog errors malformed/empty/partial | 通过（B） |

## DWUI-008

用户关闭未提交检查、替换所选包或取消仍在进行的本地检查时，SHALL 中止相应本地传输/观察并请求释放原暂存；晚到的进度和结果不得重新打开旧检查或覆盖新包。删除确认成功或已不存在后才显示清理完成，失败时保留可定位的清理信息与显式重试入口，不能以隐藏弹窗代替清理。为同一 Core 登录而暂离检查不属于放弃该包。Import 提交中、接受响应未知及已接受后 SHALL 保留该次身份及恢复信息，不按未提交检查重新提交、替换或取消远端操作；关闭仅停止本地观察。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| 离线检查后关闭 | `inspectWork / cleanupInspection` | R4/R5; TestNativeDesktopAnonymousInspectionLoginAndExplicitRelease | 通过（B/G） |
| 自动名称和显式冲突 | `importWork name/sourceName` | Work naming explicit conflict / actual Core name; real-core | 通过（B/I） |
| 导入完成或失败 | `accepted import + operation projection` | Work naming actual Core name across stages; real-core | 通过（B/I） |
| 留空名称并由 Core 自动改名 | `operation.importSourceName` | Work naming actual Core name; real-core automatic suffix | 通过（B/I） |
| 显式名称冲突后保留检查与输入 | `name field conflict + import state` | Work naming explicit conflict preserves inspection; new reconcile anonymous import | 通过（B） |
| Import 请求返回前修改名称 | `name-field response identity` | Work naming delayed Import conflict preserves cleared name | 通过（B） |
| 显式新名称不误报自动改名 | `importNameFeedback` | Work naming actual Core name explicit name | 通过（B/I） |
| 名称与受理失败恢复分开 | `importNameFeedback + original operation` | Work naming actual Core name stages / unknown; real-core | 通过（B/I） |
| 匿名检查后登录同一 Core | `acceptSession preserve anonymous context` | R4 anonymous inspection login; preferences anonymous Inspect | 通过（B/G） |
| 登录失败或切换 Core | `identity/inspection isolation` | R4 Core/account/logout changes; new reconcile anonymous import | 通过（B） |
| 检查期间取消或连续换包 | `inspection nonce / abandon` | R5 replace/Cancel/Escape; forced late XHR | 通过（B） |
| 暂存清理失败 | `cleanupPending` | R5 failed DELETE retains independent retry record | 通过（B/G） |
| 导入接受后关闭观察 | `importState unknown/accepted` | R5 unknown/accepted imports cannot resubmit/delete | 通过（B） |

## Shut down Core without destroying running Works

关闭 SHALL 保留 Work 记录、desiredState、Service 启用意图、配置、历史及匹配数据卷，不把 Core 退出隐式转换为用户的 Work stop/delete。默认 drain 30 秒、终止确认 10 秒和 Core 进程总预算 45 秒保持，Docker Compose 提供 60 秒关闭窗口。未确认关闭或超出预算 SHALL 非零退出并提供安全的未完成诊断及恢复记录，不报告正常关闭成功；关闭 SHALL 释放 listener 和 store 锁。SIGKILL、进程崩溃或断电不执行完整正常关闭流程，不得据此记录所有 Work 已停，重启沿用持久意图和资源归属恢复；本变更不新增进程外监护机制。CLI 退出 SHALL 不停止 Work。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| Stop Core and reopen its store | `Application.Close + shutdownCapturedWorks` | Core process integration; shutdown integration; new blocked-RPC probe | 通过（G/I） |
| Bound a stalled shutdown | `Close total budget + stopCapturedWork` | TestShutdownBoundsUnresponsiveCleanupAndReleasesStore; new blocked-RPC probe | 通过（G/I） |
| Stop Core through Docker Compose | `SIGTERM close + Compose window` | Core process integration + actual scratch Compose stop→up→down（60 秒窗口） | 通过（I） |
| Abrupt Core loss is not confirmed shutdown | `startup recovery fencing` | TestNativeCoreCrashAdoptsExistingAgent | 通过（I） |
| Preserve service selection through shutdown | `service desired selection recovery` | TestNativeShutdownRestartPreservesEnabledAndDisabledServices / real-core enabled-disabled Service | 通过（I） |

## CST-NATIVE-001

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；Core 完成 recovery 与容器核验之前不得开启网关。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

| Scenario | 实现判定点 | 测试/执行线索 | 本轮状态 |
| --- | --- | --- | --- |
| 空目录首次启动 | `corestore.Open` | TestFreshStoreAndSameFormatReopen; empty installation | 通过（G/I） |
| 同格式重新启动 | `corestore.Open marker/metadata identity` | TestFreshStoreAndSameFormatReopen; process restart | 通过（G/I） |
| 拒绝旧开发目录或未知版本 | `corestore validation` | TestUnsupportedDirectoriesRemainUnchanged; mismatched DB | 通过（G） |
| 初始化中断或第二个所有者 | `corestore init + OS lock` | TestInitializationInterruptionsRecoverOnlyRegisteredFiles; TestOSLockRejectsSecondProcessAndReleasesAfterCrash | 通过（G） |

## 本轮执行与发现

以下按轮次保留当时的失败、夹具修正和验证状态；完整结果在后文“最终版本结果”集中记录，早期通过轮次不能代替最终源码身份。

### 已复现缺陷与定向验证

- Core 关闭：`TestShutdownWorkloadGetsLiveBudgetDespiteBlockedControl` 首轮在 grpc 和 coordinator 两个分支失败，首次 workload 回调已是 `context deadline exceeded`；HTTP 分支未失败。修复在准入关闭和协调取消后并行启动受管 Work 收尾，控制 gRPC/HTTP 共用既有 drain 窗口，worker 等待不再挤掉首次停止预算。默认 30/10/45 秒未改。相同回归与 shutdown policy 测试已通过；真实 Engine 验证正在执行。
- 授权交错：`Reconcile auth: an old CSRF rejection cannot supersede a newer initialization` 首轮失败，旧响应继续启动授权回查并返回 `LOCAL_CSRF_OR_AUTH_REQUIRED`，没有按新认证流归属丢弃。修复为 CSRF 拒绝路径增加与业务 401 相同的检查序号前后校验。另补“旧回查已开始、随后新初始化接管”回归；两条新回归及既有 local-auth 组通过。
- 组合回归：原 Run 410/503→恢复与后台 Service Run 并存、在途 Save 后继续编辑 Advanced、匿名 Inspect→登录→名称冲突→丢受理回执，三项当前均通过。历史测试首轮在 iframe 尚未建立时就取引用，并且期望对象遗漏显式 undefined 字段；修正夹具等待和比较后通过，没有据此修改历史恢复实现。
- 当前代码的 Go 全量单元测试通过；Linux/Windows CLI 及七种 Go 程序构建通过。新一轮完整浏览器及真实 Core/Engine 链路尚在执行，暂不将其状态记为通过。

临时日志：`auth-csrf-before.log`、`shutdown-contention-before.log`、`shutdown-contention-after.log`、`combinations-after.log`、`go-all.log` 和构建日志均位于 `dist/reconcile-pending-spec-deltas/`，不含真实用户秘密。上面的失败轮次不计为验收通过。

### 第一轮真实后端与夹具维护

- `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain` 和 `TestNativeCoreCrashAdoptsExistingAgent` 已在真实 Engine/Agent 上通过；新增 `TestNativeShutdownRestartPreservesEnabledAndDisabledServices` 也通过，确认正常关闭后的受管 Agent/Service 都已停止，原 Work/context、enabled/disabled 选择保留并按选择恢复。
- 新 Service 测试首轮遗漏了无 workspace 挂载场景的合法 workingDirectory，被正常的定义校验拒绝；补齐 `/` 后通过。这是夹具输入修正，没有放宽生产校验。
- 既有 Core 进程测试假定 config set 返回时已经 ready，并要求 Core stderr 完全空白，分别与既有异步准备及结构化 performance 诊断冲突。夹具增加有界只读 readiness 观察，并只接受既有准备阶段的安全结构化诊断投影；失败/未知阶段和额外字段仍拒绝。正在重跑该进程测试，不将前两次失败计为通过。
- Console R6 通过实际 Playwright 入口执行 1 项，覆盖真实 packagePhase 枚举、失败、cleanup 和未知阶段。第一次使用 node:test 及一次过窄的 grep 没有选中测试，均不计为执行证据；最终入口为 `playwright test -c playwright.config.mjs console.spec.mjs --grep 'R6 actual Core'`。
- 真实 Desktop 的本地授权恢复分支已确认原 PID/Work/Service/文件/Run 保留，bootstrapPosts=2、resetPosts=1、businessWrites=0；完整包和 Chat controls 仍在执行。

### 再次核对：原执行错误在历史恢复后被清空

完整浏览器 300 项首轮通过后，复核发现新增历史组合夹具没有携带原 Run 的执行错误。为原失败 Run 加入实际 error.message，并要求成功读取历史后仍显示原执行错误，回归失败：status 仍为 failed，但 error 为 undefined。此前的通过不能证明该边界已正确。

`recoverRunHistory` 原先在历史读取成功后统一清除终态 error；修复改为保留原 Run GET 返回的执行错误，仅在没有执行错误时采用历史恢复提示或清除观察错误。新增真实 Core/Agentd 检查只在浏览器事件读取边界注入 410，随后读取真实失败 Run 和原 Session，要求原错误与后台 Service 的停止目标继续分别绑定，且只读恢复零 POST。正在重建并验证这一最终版本。

### 最终历史错误保留方案

执行错误与观察错误在客户端内分开保存：Run 的 executionError 只来自原 Run 投影/状态事件；error 继续承接原 UI 的显示接口。历史/Run 重新读取失败时同时显示最后确认的执行错误和观察失败，成功后仅清除观察失败。新增回归还固定了“Session 503→Run GET 503→成功恢复”的顺序，三步都保持原 Run 与后台停止目标，原执行错误不丢失、不重复。

首轮完整 Desktop 浏览器为 300 通过、0 跳过（含真实五分钟票据）；新增 Agent 邻接单元为 51 通过。历史错误字段补强后，7 项 R3/后台观察定向回归通过；最终构建、完整浏览器与带真实失败 Run 的 410 集成正在重跑，首轮完整回归不替代该最终版本结果。

Core 进程专项已通过，四个指定的 Core 正常/失败/崩溃恢复集成现均有实际通过结果。另以当前静态 Core 二进制制作独立 scratch 夹具镜像，真实执行 Compose stop→up→down，确认停止后受管运行容器为 0、原 Work/运行意图恢复。该夹具只验证 Core 信号关闭与恢复，不作为 Docker 发行镜像或公共下载验收；安装 installation-dd5ae7df01e8e070be340c1e66c58bc3 的容器/网络/卷均已精确清理为 0。

第一次完整真实 Desktop 已通过授权恢复、Save/Apply、Stop/Export/Inspect/Import/Start、启用/禁用 Service、原提交键及 Chat controls。取消等待 5096 ms，迟到补发为 false；该安装 installation-572290756a753e0eda90b9985df041f6 清理后三类资源均为 0。mainReloads=1 来自显式本地授权重新打开；普通布局、请求详情和读回仍断言同一 Service iframe 保持，身份撤销时按既有契约清理访问。

### 同类本地授权拒绝的补核

把过时授权拒绝的回归参数化为 LOCAL_CSRF_OR_AUTH_REQUIRED 和 LOCAL_AUTH_REQUIRED 后，后者仍失败：原请求返回旧 LOCAL_AUTH_REQUIRED，并可清掉新初始化的上下文。现为该路径补上相同的认证检查序号校验；当前归属的本地拒绝仍执行原清理与恢复，过时拒绝按 CONNECTION_CHANGED 丢弃，不重发原提交。它属于同一授权归属缺陷，不改变产品契约。

历史错误修复后的完整浏览器已实际完成 300 项、零失败/零跳过，真实 Core 的 410/原执行错误/后台停止目标/原键及完整包往返也通过。最新参数化拒绝检查新增一个场景，因此最终构建会以 301 项完整浏览器及原授权链路复核；先前结果保留各轮身份，不冒充最终版本。

## 最终版本结果

最终版本以 [identities.json](identities.json) 中的源码、主规格、构建二进制与镜像摘要绑定。源码基于 `93a1ab3`，modified=true；没有将这次本地构建改写为后续提交或正式发行身份。Linux 实际执行覆盖 67 项判定，Windows 仅完成交叉构建。

| 检查 | 最终结果 | 本机原始日志（均在 dist/reconcile-pending-spec-deltas/） |
| --- | --- | --- |
| `make build-cli`、随后 `make build-go` | Linux/Windows CLI 和全部 Go 程序构建成功；13 个嵌入资源文件逐字节匹配；两平台 build.json 的二进制、Desktop 输入及发行信息 hash 匹配 | build-cli-accepted.log、build-go-accepted.log、identities-accepted.log |
| `CGO_ENABLED=0 GOTOOLCHAIN=local go test -mod=readonly ./...` | 全量通过；未受影响包允许 Go 缓存，最新嵌入资源对应 CLI 重新运行 | go-accepted.log |
| Desktop 完整浏览器，`PIWORK_TEST_TICKET_EXPIRY=1` | 301 通过、0 失败、0 跳过，包含真实五分钟票据过期；三条新增授权交错和三条组合回归均实际执行 | browser-accepted.log；auth-accepted.log 为三条授权定向通过 |
| Agent 邻接取消/Run/Brain 单元 | 51 通过、0 跳过（Agent 生产源码本轮未改） | agent-neighbors.log |
| Console R6 Playwright | 1 通过，包含阶段、失败、cleanup 和未知状态 | console-r6-final.log |
| Core 存储专项，`-count=1` | 格式拒绝、内容保持、初始化中断及 OS 锁测试通过 | corestore-fresh.log |
| 真实 Core 关闭/崩溃/Helper/Service 组，`-tags=integration -count=1` | 7 个顶层测试全部通过、无 skip；package signal 的 shutdown/crash 两个子场景均通过 | core-integration-accepted.log |
| 真实配置/候选/Apply 组，`-tags=integration -count=1` | 5 个顶层测试全部通过、无 skip；忙碌拒绝、stopped Apply、原环境回退及双失败诊断、候选归属和 mixed-state 恢复均有实际断言 | configuration-integration-accepted.log |
| Desktop real-core，`LOCAL_AUTH_RECOVERY=1`、`CHAT_CONTROLS=1` | 完整链路通过：授权、Service iframe、Run、WebDAV、Save/Apply、Stop→Export→Inspect→Import→Start、原键及只读历史恢复 | real-core-accepted.log |
| 当前 Core scratch 夹具的真实 Compose stop→up→down | 60 秒窗口内正常关闭；停止及 down 后受管运行容器均为 0；重启保持原 Work 和 desiredState | compose-stop-accepted.log |
| `node --test scripts/*.test.mjs` | 81 通过、0 跳过（脚本本轮未改） | scripts-final.log |
| OpenSpec 严格校验、文档/原生边界/Quick Start 与 diff | 45 主规格及当前 change 共 46 项通过；边界、Quick Start 一致性和 `git diff --check` 通过 | openspec-accepted.log |

### 判别断言与执行边界

- 本地授权的新拒绝序号检查由 HTTP gate 夹具确定触发，原 POST 仅一次，旧结果返回 CONNECTION_CHANGED，新的 session 检查与登录页面归属保持；没有自动 bootstrap/login。真实授权链路另外确认 bootstrapPosts=2、resetPosts=1、businessWrites=0，原 PID/Work/Service/文件/Run 均保留。
- 历史恢复的 410 仅由浏览器路由注入；原失败 Run、Session 历史及 execution error 来自真实 Core/Agentd。新增驱动在返回瞬间断言原 Run ID、原错误及后台 Service 活跃 ID，要求原 Run GET 至少两次、原 Session GET 至少一次、事件过期入口只读一次、恢复零 POST。HTTP 夹具另覆盖 Session 503→Run GET 503→成功，确保观察失败不清除原错误。
- 真正的执行错误只存于客户端 executionError，未新增 API、存储或历史格式。原事件流结束和显式再次观察也保持该错误；后台停止目标、下一条草稿和同一 Service iframe 不受影响。
- 真实 Chat controls 的取消等待为 5065 ms，lateSubmission=false；包往返保留旧/新 Run、原接受键及历史只读约束。真实 Desktop 的 mainReloads=1 来自显式本地授权重新打开，普通布局、请求详情及读回仍断言同一 iframe 保持；不是把任意重载计为通过。
- Core 阻塞 gRPC/HTTP/协调器的定向测试使用缩小预算固定交错；默认 30/10/45 秒由 shutdown policy 断言单独核对。真实 Engine 另外验证失败收尾仍尝试其他受管运行时，正常关闭确认已停，崩溃恢复沿用归属和意图，enabled/disabled Service 选择恢复。
- Compose 使用当前 Core 二进制的独立 scratch 夹具、同一个安装数据 bind、合成环境值及精确标签清理。它验证信号关闭和重启，不构成发行镜像或公共下载验收。

### 资源与冻结输入

最终日志可定位的 11 个 Go 测试安装，加真实 Desktop 与 Compose 两个安装，共 13 个 installation ID，独立只读复查均为 containers=0、networks=0、volumes=0；测试没有执行全局 prune。未输出或持久化真实用户凭据、内容或私钥。

冻结的 521 个归档/入口/发布文件逐文件 SHA-256 与起始基线一致；当前主规格字节未修改。原平台九项与 Docker 公共交付一项任务正文和未完成标记完全一致。附加身份记录保留它们的数量与冻结清单摘要，不改写旧发行记录、旧证据或归档任务。

本变更维持 `skip_specs: true`；最终改动仅涉及已复现的三类实现偏差、必要测试/夹具、生成的嵌入资源和本变更规划/证据。上述验收阶段未执行 Git 提交、变更归档、镜像推送或对外发行；后续按用户指令归档和提交，不改写本轮源码、dirty 状态、二进制或镜像的验收身份。
