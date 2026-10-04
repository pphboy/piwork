# Design

## Context

动机与范围见 proposal.md。当前两套应用都是轻量 TypeScript app/adapter，由 Go 二进制嵌入构建产物；本次不改变这一结构。

已核对的实现事实：

- Desktop `app.ts` 使用 `actionPending` 禁用整页动作；文件选择另走异步入口，没有相同保护。`adapter.lifecycle` 在 acceptance 后继续等待 `loadWork`，`saveConfig` 和 Skill copy 在修改后等待配置读取；这些串联会隐藏已经确认的结果。
- Desktop Service 已有入口缓存与有界 embed 查询，Files 已有条件写入与逐路径结果，Inspect 已有 XHR 上传、transfer 查询和关闭释放规则。这些能力保留，不用新的反馈状态替代其事实。
- Go `prepareDesktopDownload` 接受 UUID v4 的 `X-Piwork-Transfer-Id`；POST 在拉取、校验完整 `.work` 后才返回 ready。`GET downloads/:id` 能在 POST 尚未结束时查询真实字节和阶段。当前浏览器在 POST 返回后才观察，因此遗漏实际准备过程。
- Serve 已有登录、保存、Package acceptance 和 XHR 上传反馈；部分手动检查没有初始状态，部分用户/目录修改先关闭弹层再等待读取，失败处理可能访问已经不存在的弹层。`uploadSkill` 也将上传确认与目录刷新串联。

探索阶段用隔离浏览器拦截请求复现了 Start 等待/接受后慢读回、Download 等待无进度两个案例，没有改动用户 Core。其余入口的缺口来自代码审阅，实施时必须逐入口以延迟响应验收；模拟响应不作为真实 Core 全链路已通过的证据。

## Goals / Non-Goals

**Goals:**

- 用原页面、按钮和结果区域呈现动作所属对象及已知阶段，遵守 DUL/UIL；首个可绘制机会即可看到等待状态。
- 使修改结果、后台 Operation/Run、辅助刷新及传输观察相互独立，避免未知重发和晚结果污染。
- 在不改变后端协议的情况下完成 DWUI-011—013、SUI-005—006 与 BSA-005 的逐入口验收。

**Non-Goals:**

- 不增加服务端队列、任务历史、取消 API、跨进程恢复、通用状态管理框架或持久化前端动作记录。
- 不改变已有 Work 准入、Stop 取代 Start、Run 恢复、条件覆盖、Inspect/Import 释放、凭据及 iframe 安全边界。
- 不用任意固定延时制造动画，不给普通选项切换、复制、同步导航统一加 spinner。

## Decisions

### 1. 每个应用使用轻量动作状态，保留业务模型

在两套应用各自增加轻量 `action-state.ts`，由 app 渲染、adapter 在真实阶段变化时发布。记录包括身份 generation、对象 scope、action、request token、开始时间、阶段、最后确认时间和安全结果。Operation、Run、transfer 继续使用既有业务身份；动作状态不复制它们的终态判断。

状态按事实推进：reading/submitting/uploading/verifying → confirmed 或 accepted；辅助 refreshing 是独立字段。失败包含明确拒绝和原有结果未知两种语义。任何 HTTP 成功并不自动等于业务成功，必须按各接口响应契约确认。

在首个 await 前注册并渲染状态，原按钮用 Creating/Starting/Saving 等文本，所属区域显示目标与 `aria-busy`，结果区域采用 live status。十秒仍无新确认显示 Still waiting 与已等待时间；这只是提示，不是超时判定。计时器在动作结束、身份切换和销毁时清理。

同步确认/acceptance 先保存并 emit，再启动辅助读取；读取失败只更新 refresh 字段，不落入修改 catch。界面只对有实际终态的 Operation 显示对应终态，accepted/pending/running 等按原响应映射，不继续套用统一 Preparing。成功标记与错误视觉不能混用。

选择局部辅助模块是因为现有 app 无框架且业务模型已完整；全局 spinner 不能表达对象，通用任务队列会扩大范围。两个应用保持接口语义一致，但不为共用少量状态代码新建跨应用运行包。

### 2. 冲突锁仅覆盖真实在途提交，后台观察不占提交锁

锁由同一动作协调器管理，鼠标、键盘、文件选择均经过它。冲突采取双向检查，不自动排队；被阻止时显示哪个目标正在处理。

| 范围 | 在途约束与允许行为 |
| --- | --- |
| 身份 | Login/Sign out/Switch Core 在途互斥并阻止平台修改；匿名 Inspect 仍遵守既有准入，身份切换不使其越权 |
| Work 生命周期 | 同 Work 的 Create/Start/Stop/Delete 提交防重复；已有同 Work 文件、配置、Service、Run 提交未确认时不能提交冲突生命周期动作，反向亦然 |
| Files | 同 Work 文件修改串行，读取按资源去重；不同 Work 和合法非文件动作可用 |
| 配置 | 同 Work Settings 保存、Skill copy、Pi Package 提交串行；编辑草稿、关闭和复制可用，Apply 继续使用既有 Run/生命周期准入 |
| Service | 控制锁按 Work + Service 绑定，不包含浏览器端口；切换端口或重开详情不能绕过。同 Service 控制串行，与同 Work 生命周期提交互斥，不锁其他 Service 的合法动作；预览入口仍按 Work + Service + port 区分 |
| Session/Run | 同 Work agent 提交通道防重复；会话读取可用，Run 活跃/Cancel 资格由既有模型决定 |
| Inspect/Import | 复用原 inspection nonce 和提交状态；未提交关闭仍释放，已提交/未知保留原恢复规则 |
| Download | 同 snapshot 的准备防重复，关联原 transfer；与无关对象不互锁 |
| 手动读取 | 同对象同查询与后台轮询共享一个在途 promise，后发手动检查接管可见状态，不新增并行请求 |

取得 acceptance 后释放请求锁，再按真实业务状态判断可操作性。Start 已接受且允许 Stop 时，不因 Start 观察仍进行而禁用 Stop。Operation 的两个身份分别保留。

普通 Close/Back 不取消服务器修改；普通读取可中止本地观察，但不能据此声称远端取消。提交后关闭时结果归属原对象，在当前会话的原对象/已知活动中可查看，晚结果不重新打开弹层。保持已有 dirty guard。

保留整页锁虽然简单，却会遮蔽无关动作并让文件入口漏锁；本次用明确冲突表替代，不建立后台排队功能。

### 3. 明确逐入口反馈与验收映射

以下矩阵是实施与测试清单；每行的各个动作均须覆盖，不以一个代表按钮替代整行。快捷键和文件选择与按钮共用语义。

| ID | 主路径入口 | 请求返回前 | 确认之后 |
| --- | --- | --- | --- |
| D01 | Login/Sign out/Switch Core/Check connection/Retry Works | 身份或连接目标及 Signing in/out、Checking、Loading | 新身份/确认时间或原有未知语义；Works/readiness 独立读取 |
| D02 | Create Work | 表单 Creating 与提交名称 | 原 Operation 立即出现，Work 读取独立 |
| D03 | Start/Stop/Retry/Delete | Work 行与 Starting/Stopping/Deleting | acceptance/已确认删除先显示，列表更新独立 |
| D04 | Open Work/Settings/深链接/Check status | 目标 Work 加载壳，不能把缓存当本次成功 | 页面到达、缺失/拒绝/失败、最后确认时间 |
| D05 | Services/Files/目录路径/模块刷新 | 所属模块 Loading，缓存标为最后已知 | 空列表与失败分开，不覆盖新 Work/路径 |
| D06 | Session 列表/创建/切换 | Session 目标 Loading/Creating | 对话到达或错误，晚读取不替换新 Session |
| D07 | Send/Cancel/Resume Run | 原对话 Sending/Requesting cancellation/Reconnecting | 原 Run 身份与接受事实先显示，取消接受不等于已取消 |
| D08 | Service Start/Stop/Restart/Retry/Remove | Service 行动作与名称 | 原 Operation 或同步确认，状态读取独立 |
| D09 | Service details/Read/Refresh logs | 原 Service Reading logs | 内容、空日志、不可用及时间分开 |
| D10 | 入口/端口选择/Preview 检查/独立打开 | Service/port Preparing、Checking preview | ready/denied/unknown/失败及回退，不重建同一 iframe |
| D11 | Open file/Save/Re-read | 原文件 Reading/Saving | 条件修改结果先显示，验证读取单列，新草稿保留 |
| D12 | Files 上传/覆盖 | 目标检查、当前文件、真实发送字节 | Waiting for confirmation → 逐路径结果，刷新独立 |
| D13 | New folder/Rename/Move/Copy/Delete | 对应路径与操作中 | 逐路径确认、部分失败/未知，目录读取独立 |
| D14 | Settings Save/Refresh/Apply/Skill copy | 配置 Saving/Reading 或 Copying | 保存确认或 Apply Operation；后续配置/loaded 状态独立 |
| D15 | Catalog 读取/AGENTS 与 JSON 文件导入 | Loading catalog/Reading selected file | 预检结果与新草稿，旧文件晚读取无效 |
| D16 | 五种 Pi Package 来源安装/更新/移除 | 提交中；本地目录/ZIP 有上传与等待校验 | Operation 立即出现，Installed/Apply/loaded 各按事实 |
| D17 | Inspect/Import/Check transfer/本地清理 | 沿用预检/提交阶段并补全查询/清理反馈 | 原 transfer 与 acceptance；未知不重发、关闭规则保留 |
| D18 | Prepare/Check Export | Work、Snapshot、提交/查询中 | 原 Operation/Snapshot；仍先 Stop 后 Export |
| D19 | Download/Check transfer/再次下载已就绪内容 | 原 Snapshot 准备、下载字节、校验 | 原 transfer ready 或失败；只宣称 Download started |
| D20 | Known Operations/Lookup/Refresh/恢复观察/查询 Snapshot/清空本地记录 | 原记录 Reading/Checking 或清理中 | 确认时间、正确阶段、明确失败；纯本地同步清空及时呈现 |
| S01 | Health/Runtime 验证/Retry connection/Operation refresh-resume/Read configuration/Sign out | 原区域 Checking/Reading/Signing out | 确认时间或失败/未知，后台轮询不抢占反馈 |
| S02 | Skill/Package 目录、ZIP、AGENTS 本地预检 | Checking selected files | 新选择确认后才提交，旧选择和新草稿受 token 保护 |
| S03 | User create/enable-disable/password reset | 原表单 Creating/Saving | 可靠确认及用户入口先显示，Users 刷新独立，自撤销优先 |
| S04 | Skill 添加/更新/控制、Package 控制 | 原对象上传字节/提交中 | 确认先显示，catalog/defaults 刷新独立，未知沿用既有恢复 |
| S05 | Login/Runtime/Defaults Save/Package install | 保留已有等待/上传并补齐阶段 | 保存或 acceptance 先显示，readiness/辅助读取独立 |

复制与纯本地导航使用现有简短提示/页面到达；同步清空记录不人为异步化。上表不增加不存在的 Core 操作，也不承诺所有 Service 有可预览 Web 入口。

### 4. 身份、视图与草稿分别校验

每次请求捕获 Core/account generation、Work/resource、view token；完成时只更新匹配的对象记录。渲染前验证当前视图，拒绝旧请求替换新 Work、路径、Session 或弹层。身份改变清空原账号的动作、观察及敏感上下文。

保存时捕获提交的草稿版本。确认后更新保存基线，只在当前内容仍等于提交版本时清除 dirty；用户期间的新编辑保留为未保存。非敏感草稿可保留，密码/key 按现有清空规则处理，不进入动作状态、日志或验收截图。

成功、失败和 finally 清理都属于原请求，均须遵守上述归属。Runtime 保存捕获原输入节点或等价的提交上下文；敏感输入清理只能作用于该上下文，不能无条件查询当前 DOM 的 `#apiKey`。离开后返回同一路由也必须产生新的视图 token。旧提交及其 readiness 回调不得清空新输入、覆盖新草稿或释放新提交锁；原已提交 Key 仍按既有清空规则处理，不缓存其值或从后端回填。

明确拒绝允许用户修正后重新提交；网络丢失等结果未知保留原身份并提供既有只读核对，不自动重发。读取失败只重试读取；旧缓存明确标记，首次读取失败不显示成功空态。

未知结果核对按对应动作记录恢复，核对上下文包含原 Core/account generation、Work、动作与涉及资源；Operation 查询还要以实际响应对象及已有业务身份判断关联关系，不能把当前页面 Work 当作返回 Operation 的 Work。其他 Work、同 Work 无关 Operation 或无法确认关联关系的查询仅展示查询结果，不解除原未知锁。不以一次 check-work/check-operation/lookup-operation 成功批量解除 lifecycle/transfer/agent 记录。已有接口能确认原目标当前事实或原业务身份时，只恢复对应动作的既有准入，并区分原提交未知与当前事实已核对；证据不足时保留未知和原对象核对入口。此修复仅调整浏览器状态协调，不新增 Go Core/CLI 业务 API 或幂等协议。

### 5. 上传只展示能够观测的字节

Files 保留原 File、WebDAV 方法/条件头和逐文件串行；PUT 改为可报告 `upload.onprogress` 的 XHR，携带现有 CSRF/会话规则。HEAD 检查时显示 Checking target，发送结束但响应未到显示 Waiting for confirmation；不提前累计成功。207、条件冲突、未知、部分失败与原结果解析一致，不把整个文件读入额外内存，不自动重传。

本地 Pi Package multipart 使用相同上传机制，浏览器到 CLI 的字节可量化。发送结束显示 Validating and forwarding；没有 CLI 到 Core 字节接口，因此不显示其百分比。Core/npm/Git 来源只有提交阶段。既有 Inspect 与 Serve 上传复用其进度机制，只统一归属与并发规则。

仅用 fetch 与动画估算无法满足真实进度；新增后端转发进度协议又超出范围，故采用浏览器可观测字节与不可量化阶段组合。

### 6. 下载准备与观察并行，复用现有协议

浏览器在一次 Download 意图开始时生成 `crypto.randomUUID()`，保存 identity、snapshot、transfer 及动作 token，带既有 CSRF 与 `X-Piwork-Transfer-Id` 发出一次准备 POST，同时每 500ms 串行 GET 原 `downloads/:id`。

- POST 中前置 metadata 查询可能早于 transfer claim；POST 未结束且尚未观察到 job 的 404 视为 Preparing，不误报终态。POST 明确失败后停止初始等待；已经观察到 job 后的 404 表示原传输不可用，不新建 transfer。
- 展示 GET 的 downloading/validating/ready/失败，以及 transferred/可用 total；只有已知有限有效 total 才计算百分比。POST ready 和 GET 结果统一按同一 transfer 更新，不由晚到的旧查询覆盖已确认 ready。
- GET 暂时失败标记观察中断，保留最后确认；暂停自动查询，Check transfer 只 GET 原 id 后恢复观察。原 POST 仍可确认 ready，不因观察中断被取消或重复发送。身份拒绝/变更停止旧观察。
- 关闭弹层停止该视图轮询，保留准备 POST 和当前会话对象记录；回到原 Export/已知活动可重新查询同一 transfer。若完成时原发起视图仍有效，可接续内容下载；若已经离开，不自动打开保存窗口，而在原上下文提供 Download。
- 内容下载仅使用原 ready transfer 的受保护 content URL，显示 Download started。页面退出或 CLI 停止可能终止准备，不能承诺系统文件写入确认或跨进程续传。

Go 协议不改动；增加契约测试以慢速合法包验证“POST 未完成时原 id 可查询字节”。这比另设 preparation API 更小，也纠正只在 POST 之后轮询的当前实现。

### 7. Service 反馈保留应用 DOM 和安全边界

入口缓存继续按 Work/Service/port 键使用；准备失败结束 opening 状态，显式 Retry 才重新创建授权入口。有界 embed 检查结束仍 unknown 时展示 Preview not confirmed、Check preview 与独立打开；检查只查询原 entry，不重新加载 iframe。单独的 load 事件不能证明可用，也不能通过跨 origin 读 DOM 判定。

独立打开在用户手势内预留窗口，获得 WindowProxy 后立即隔离 opener，再执行需要的异步授权。不能单用 `window.open(..., 'noopener')` 返回 null 判定拦截，因为窗口可能已创建但未返回句柄。确实未创建则在原 Service 显示允许弹窗、Copy local link；正常独立视图使用受保护本地链接。异步授权失败关闭本次准备空窗并在原页面显示错误；不关闭用户其他窗口。

不去掉 CSP/X-Frame-Options，不暴露 ticket，不要求 PAC/浏览器代理；正常外壳与禁止嵌入直接应用两种视角继续符合 BSA-005。

### 8. Serve 的确认和读回采用两个独立阶段

用户/目录修改方法只返回真实修改结果，Skill 上传不在同一 promise 中等待目录。app 先提交确认到稳定的页面结果区域、清空敏感输入，再关闭已完成弹层并发起 Users/catalog/defaults 读取。刷新失败只写稳定页面，不访问不存在的 dialog，不将创建/上传写成失败。

Runtime/Defaults 保存保留其接口语义，保存确认先渲染，readiness 单列 Verifying；读回与草稿版本控制适用第 4 项。自撤销登录态优先于普通刷新结果。手动检查与后台 Operation 查询共享在途读取，完成相同值时也更新确认时间。

### 9. 验收同时阻塞请求与后续读取

浏览器测试逐个参数化 D01—D20/S01—S05 的实际入口：保持响应 promise 未释放，断言首屏可见目标/动作、重复提交数量、合法 Close/复制/无关动作；再释放 acceptance/确认但保留辅助 GET，验证原身份与结果已显示；失败 GET 不触发第二次 mutation。

另外覆盖文件/包实际进度事件、没有 total、查询中断与原 id 恢复、晚响应/新草稿/身份切换、popup 拦截与授权失败、unknown embed、iframe 节点保持、Stop 取代 Start。纯读取、空数据和快速成功分支纳入矩阵；已有 Inspect/Import、Run、条件覆盖与未知恢复测试继续通过。

三个核验 WARNING 作为独立回归：延迟 Service Restart 后切换端口、重开详情仍仅一次控制请求且其他 Service 可操作；丢失 Start 响应后查询另一 Work 或同 Work 无关 Operation 不解锁，原对象合法核对只恢复对应记录；延迟 Runtime PUT 或 readiness 后离开再返回，旧成功、失败及清理不改变新 Key/草稿/提交锁。使用隔离响应和测试凭据验证，记录真实请求数量与输入保持；修复后重新构建两套 UI 并同步 Go embed 资源，以实际嵌入资源验证交付。

Go 下载契约测试验证真实并行链路，浏览器模拟验证状态展示，两者分开报告。构建两套 UI 并同步 Go embed 资源，运行对应浏览器/Go 回归以及现有隔离真实 Core 主路径测试。截图检查桌面与窄屏长状态文本和焦点，不截图密钥。验收记录在 `docs/webui-integration.md` 明确每个矩阵入口的测试与事实边界。

## Risks / Trade-offs

- [局部重绘导致输入失焦或 iframe 重建] → 沿用当前 DOM 保留机制，动作区域增量更新，以节点身份/输入与焦点测试约束。
- [锁层级遗漏文件选择或过度锁定] → 单一动作协调入口、双向冲突表和每种入口的请求计数/无关动作测试。
- [修改成功后刷新报错误导或旧结果覆盖新草稿] → 独立 confirmed/refresh 字段、身份/视图 token、草稿版本及两阶段延迟测试。
- [下载初始 404/查询竞争被误判失败] → 记录是否 claim 已可见、POST 结果与原 transfer 身份，验证真实慢速 POST。
- [上传字节与远端确认不同步] → Sending、Waiting for confirmation、Accepted 分开；未知阶段不展示估计百分比。
- [弹窗处理差异] → 用户手势同步创建且立即隔离 opener，模拟拦截/授权失败并用首版桌面 Chrome/Edge 实测独立打开。
- [关闭后无法跨刷新恢复前端动作记录] → 只承诺当前页面会话，沿用现有后端 Operation/已知 snapshot 查询，不增加持久任务队列。

## Migration Plan

按 tasks.md 先落动作协调与状态呈现，再逐模块拆分确认/刷新，最后补传输与独立打开。现有 API、文件格式和存储无需迁移。构建输出必须与源码一并验收，避免 Go 实际提供旧 UI。

发布前通过矩阵和既有回归；回滚时整体恢复两套 UI 源码与对应 embed 产物，无服务端数据回滚。实施阶段发现后端响应契约与上述核对事实不同，应明确报告并更新规划，不自行扩大 API。
