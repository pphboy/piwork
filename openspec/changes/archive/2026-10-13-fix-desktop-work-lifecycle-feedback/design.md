# Design

## Context

动机和范围见 proposal.md。现有前端是 TypeScript + 原生 DOM，编译后由 Go CLI embed 提供；Core 接受目标和 Operation 后异步执行。现有 `work-lifecycle`、DWUI-003/010/011/012、DUL-003/007/008 已规定停止证明、只读恢复、对象锁和产品语言，本变更新增 DWUI-016—019 将前端收敛行为具体化。

已核对的实现事实：

| 位置 | 现状与影响 |
| --- | --- |
| `src/adapter.ts` 的状态映射 / `src/models.ts` | 缺少 provisioning/Preparing；Core 正常创建阶段被投影为 Unknown |
| `accepted`、`createWork`、`recoverOperations` | 有原 ID 记录，但 Create 与恢复未建立 Work 的可用关联；已有 `operationId` 只在单次 lifecycle 提交时设置 |
| `scheduleOperationPoll` | 仅自动查询在当轮发现终态时刷新 Work；刷新错误被吞；手动查询先取得终态会跳过刷新；没有独立的待同步记录 |
| `src/app.ts` 底部的五秒刷新 | 仅当前可见 Work 面板取得元数据/Service，不能补偿 Works 列表，错误也被忽略 |
| `quickAction` / `workPage` / Operation 详情 | 分别依赖 observed、少量本地关联和通用 phase，接受目标与实际状态不一致时有错位风险 |
| `src/action-state.ts` | `finish` 生成 Checked，`message` 追加原始 ISO 时间；渲染全部保留记录，多个目录 anchor 产生累计状态条 |
| `test/feedback.test.ts` | 已验证首帧反馈、一次 POST 与 acceptance；部分 fixture 不推进 Work 状态，不能证明终态和按钮收敛 |
| `test/real-core.mjs` | 创建后由测试端等待 Core ready 再 page.reload，无法证明浏览器自行更新到就绪 |

Core `workView` 已返回 desiredState、observedState、controlVersion 和 updatedAt；接受响应有 Work/Operation ID，Operation 查询有 kind、state、diagnostics 和安全错误。`AdvanceWorkControl` 先改变 desired/controlVersion；Stop 的 observed=stopping 在异步收尾中更新，因此 accepted Stop 与最后 observed=ready 同时存在是必须表达的合法阶段。当前证据确认前端缺口，没有证明 Core 生命周期执行器需要修改。

## Goals / Non-Goals

**Goals:**

- 为当前身份的 Work 建立统一状态投影和只读观察协调，供列表、面板、详情共用。
- 固定刷新义务、旧结果过滤、重载关联及反馈保留规则，编码阶段可直接执行。
- 用受控交错测试验证失败恢复，用真实 Core/Docker 验证执行边界，二者分别记录证据。

**Non-Goals:**

- 不增加服务端字段、数据库迁移、轮询专用后台 daemon、WebSocket 生命周期协议或第三方依赖。
- 不用历史 Operation 时间推断服务器控制顺序，不把 Operation succeeded 当作所有能力已可用。
- 不将等待管理改成隐式写入队列，不清理其他工作树、tmux 或 Docker installation。

## Decisions

### 1. 分离服务器事实、已接受意图和读取状态

在 Desktop 模型中保留 Core 原始 desired/observed、controlVersion、updatedAt，以及该 Work 的实际取得时间和读取错误。`state.lastChecked` 是连接检查时间，不能充当每个 Work 的确认时间。加入 Preparing 并覆盖 Core 的全部既有 observed 状态；deleted 进入移除/查询路径。

用对象投影生成行、身份栏、状态页的同一份主状态、辅助说明和快捷动作。投影输入包括：已确认 Work 快照、当前身份本次接受意图、相关已知 Operation、查询状态及未知提交锁。请求提交中显示 Creating/Starting/Stopping Work；接受目标显示对应动作 accepted，旧 observed 在需要时标为 Last confirmed。正常终态只用 Core 元数据确认，不乐观写入 Ready/Stopped。

| 已确认事实 / 意图 | 快捷动作与内容 |
| --- | --- |
| preparing/starting、运行目标，或本次 Create/Start/Retry accepted | Stop Work；按需查看原操作；不开放尚未确认的能力 |
| Ready/Degraded、无停止/删除目标 | Stop Work；Service/Chat/Files 各按既有能力准入 |
| Stop accepted 或 desired=stopped 且实际未确认停止 | Check status；展示停止目标和最后事实；不新发 Run、Service 控制或文件写入 |
| desired/observed 均 stopped 且无当前冲突 | Start Work；Settings 可达；Export 按现有准入 |
| Failed 且 desired=running，无未决停止/删除目标 | Retry Work，并有原因和原操作入口 |
| Failed 且 desired=stopped，或真实 Unknown | Check status；停止失败不转为 Start/Retry/Export |
| Delete accepted / deleted /列表确认移除 | 观察原 Delete；移除后不保留可运行行或假撤销 |

Stop 接受后收起/禁用新的运行交互，已加载的内容按最后已知规则处理；不以外壳缓存证明 Service 已可访问。进入确认 Ready/Degraded 后，对当前打开 Work 重新读取必要能力并恢复原 Service/Session 选择，不自动创建 Session/Run，不改变 Service enabled。普通状态更新在同一可用 Service 的 iframe 上原地更新；真正停止时允许结束预览，重新启动不保证应用内未保存输入恢复。

采用集中投影，避免继续在三处单独拼接状态或把所有失败统一为 Unknown。

### 2. 按 Work 关联已知操作，保留多操作而不猜当前目标

为当前身份维护 Work 到已知生命周期 Operation ID 集合的索引；接受 Create 与其他控制、恢复 known-operations、按 ID 查询都维护同一关联。规范类型 `create-work/start-work/stop-work/retry-work/delete-work` 与 CLI 英文类型统一成动作枚举，英文 label 只用于展示，身份必须检查返回 Work ID/Operation ID。

本页接受的最新意图用本地单调序号表示，记录对象、动作、原 ID 和接受时的已知版本基线。重载后先查询 known-operations 和 Work，再按原 ID 确认；只显示未决或需恢复的关联详情。唯一匹配目标的未决操作可作为直接详情入口；多个候选时显示 Related operations 并列出原 ID，不能按 recordedAt 最大值伪装成 Core 当前 Operation。metadata 的 desired/controlVersion 始终是服务器当前目标的依据，历史结果不能取代它。

已接受 ID 继续由现有 Go CLI 的最小记录持久化；前端不新增 localStorage 凭证、草稿或请求正文存储。清除本地已完成操作列表不删除内存中尚未完成的 Work 同步义务；记录隐藏不能取消远端操作。

待同步记录独立保存原 Operation ID、Work ID、已确认终态及所属本地接受代次。终态证据只能来自原 ID 的有效查询，不能由清空历史、历史时间或 Work 当前状态推断。Clear local records 可以移除 CLI 已知历史和界面历史条目，但不得删除尚用于 Work/列表同步的终态证据；原 ID 仍可从所属 Work 查询。状态投影与同步收尾同时使用这份协调依据，不能将已经成功的原操作因历史条目消失而重新认定为未决。

原终态与接受代次匹配、Work 和必要列表均确认后，解除对应接受意图，再释放不再被同步或意图引用的协调记录。清理期间出现新的 Stop 等接受意图时，旧 Start 的清理或晚返回仅影响旧代次，不解除新意图或未知修改锁；身份切换清理旧身份协调依据。不新增持久化格式，也不将清空历史解释为取消远端执行。

现有接受响应可返回 `localRecordSaved=false`：保留原 acceptance、内存观察和 ID 复制入口，明确本机记录未保存、重载可能需要手动按 ID 查找，不重发 POST 或虚构持久恢复保证。

### 3. Operation 查询与 Work 同步各自完成

在 adapter 中统一只读协调：接收 Operation 查询结果的路径负责登记受影响 Work 的同步义务，自动轮询、手动检查、恢复和深链接查询调用同一路径。同步义务独立于 Operation 是否终态，不依赖某一轮 `changed` 布尔值。

- 接受生命周期目标后立即发布原 ID 和意图，再请求轻量 Work 元数据；Create 尚未读到对象时可由原操作持续观察，不能用部分配置构造已确认 Work。
- 活跃已知生命周期操作在可见页面每两秒查询原 Operation 和所属 Work 元数据，重复的同身份/同 ID 在途查询复用；Works 列表和面板都使用该数据。
- 当前 Work 的常规事实检查保留五秒频率，由同一协调入口去重；不为每个历史完成操作重复加载整个 Work。
- 接受、Operation 终态或 confirmed deleted 时标记必要列表同步。每轮只对受影响 Work 与必要列表 GET；元数据先发布，当前面板的 Service/Session/配置关联读取独立完成，某能力失败只局部降级。
- Work 快照和必要列表均确认后解除同步义务；终态操作的只读同步失败仍保留义务，界面给 Work status not confirmed/Retry checking。操作成功和刷新失败分别显示。
- 同步收尾使用独立保留的原操作终态依据，不依赖该操作仍在可见历史数组中。Start succeeded 后 Work 读回失败、用户清空记录、随后 Work/列表确认 Ready 时，自动恢复 Ready 及对应使用入口；不继续显示 Start accepted，不要求重载、重新查找历史记录或再次 Start。
- Delete confirmed 后可用成功列表缺失或该 Work 元数据 404 收敛移除；单独一次 404 不能证明未知 Delete 已完成，原 Operation 仍观察。
- 清空列表必须来自成功的列表响应。列表失败保留最后确认行并说明未确认，不能变成零计数。

选择这些已有 GET，避免新增 Core 接口或让列表仅靠当前面板定时器修复。

### 4. 只读超时、重试和观察释放有界

仅生命周期观察用的 Operation/Work/列表元数据 GET 设置十秒单次截止时间；超时取消本次读取并保留最后事实，不推断远端失败。普通文件、包传输和业务 POST 不套用该截止时间。

成功时沿用两秒活跃观察与五秒当前面板检查；连续暂时失败最多四次尝试，第一次失败后分别间隔一、二、五秒。第四次失败暂停该查询/同步义务的自动尝试，保留错误和 Check status。显式检查、重新进入页面或从隐藏恢复可重新开启有限只读检查；用户主动 Pause 的 Operation 仅在显式 Resume 时恢复其查询，常规 Work 事实检查与远端执行独立。

同类在途 GET 合并，独立对象可并行，观察元数据请求最多四个并发；某对象阻塞不拖住其他对象。明确 ID 404/410 停止该 ID 周期观察并保留原因；鉴权失效走现有平台/本地授权恢复。隐藏页面停止调度并取消本地元数据读取，显示后重查；身份变更释放全部旧协调资源。详情关闭只结束详情的展示订阅，当前页面的已知任务索引继续提供原操作入口。

调度按当前身份、对象 ID 及接受代次维护各读取的在途状态和下一次检查时间。调度器只派发已到期且未在途的对象；结果完成后独立发布事实、更新该对象的检查时间并处理同步义务。一次派发不等待所有对象的 Promise 完成后才安排下一次检查，也不以全局整轮执行锁阻止正常对象继续读取。资源允许时，正常活跃对象按两秒频率跨多个周期推进，即使另一对象仍等待十秒截止；请求槽位满时经有界并发协调器公平等待，不通过重复派发同 ID 绕开限制。当前面板五秒检查复用同一读取入口，仍服从各对象的退避和耗尽暂停。

四次失败后的暂停适用于该身份/对象的共同读取入口，当前面板五秒检查不能绕开耗尽保护；仅上述显式恢复或可见性/页面重新进入触发有限新一轮检查。

未知修改保护、同对象提交锁、原幂等键和所有 POST 重试规则保持既有 DWUI-010/012；协调器只有读取权限。

### 5. 用版本和观察归属阻止旧结果倒灌

每次观察绑定身份 epoch、Work/Operation ID、发起序号和本地接受意图代次。一次新的生命周期接受使接受前发起的 Work 状态读取失效；对应旧 Operation 可以更新自己的详情，不能发布为新的当前目标。快照具有 controlVersion 时拒绝低于已确认版本的数据；同版本并发响应按本地读取序号避免晚结果回退；跨列表和单对象读取使用同一合并入口。

GET 去重的键包含对象的接受意图代次；新接受后的状态确认不能复用接受前已在途的旧 GET。被取消或失效的旧 promise 结束时只能清理自己的记录，不能删除新代次的读取或释放新提交锁。

新的查询取得更高 Core 控制版本时以其实际 desired/observed 为准，允许另一客户端的合法目标改变；仍保留本页原操作及其结果，不猜测该新目标的未知 Operation ID。Core Operation 响应没有 targetVersion，不能为恢复代码虚构这一字段；用关联集合、Core 元数据和本地意图代次承担相应边界。

列表响应若早于某对象的新接受/更新，不能凭该旧列表删除新创建行、恢复删除行或覆盖新状态；延后相关成员变化并重查列表。仅确认 deleted 的对象可建立当前身份的移除标记，旧列表不能重新插入它。身份切换后不使用这些标记或关联，导航变化也不能自动打开旧详情。

### 6. 反馈协调记录与 UI 展示期限分开

保留 ActionState 的对象冲突、未知结果和确认能力，但增加明确的展示类别，渲染不能直接遍历全部记录并统一拼接 target/phase/time。

| 类别 | 展示与生命周期 |
| --- | --- |
| 普通读取 | 等待时显示模块 Loading/Reading 和 busy；成功后由内容承接，移除完成条 |
| 手动 Refresh/Check | 当前模块一次 Refreshed/Status checked，三秒后消失；背景读取无此提示 |
| 已确认同步保存 | 既有 Saved/文件结果提示三秒；不再追加通用 Confirmed 条 |
| 生命周期已接受 | Work 行/身份栏与原操作详情承接目标和进展；短提交提示不持久堆积 |
| 错误、未知修改、刷新失败 | 在所属模块持续给安全原因和恢复入口，匹配核对成功后清理；到期计时不解除未知锁 |

模块已有同一错误或进度时仅展示一次；不会通过删掉渲染条清除实际协调记录。真实时间在 Operation 详情、缓存/过期说明和按需技术信息中保留；普通提示不附带原始 ISO 字符串。超十秒等待基于实际经过时间，aria-live 只播报有意义变化，不每秒重复全部时间文本。

不采用隐藏全部状态条的 CSS 补丁，因为它也会隐藏未知写入与恢复反馈；不新增常驻通知中心。

### 7. 验收交付从 UI 闭环到执行证明

- 受控浏览器/状态测试：精确控制 accepted、provisioning、starting、running、终态及读取交错；断言状态、目标、按钮、原 ID、最终内容与 POST 次数，不只查某个通用提示 div。覆盖暂时失败/耗尽、手动先终态、重载、Pause/Resume、切换对象/身份和 Stop 取代 Start。
- 反馈回归：多目录读取后没有历史 Checked 条；手动检查三秒消失；未知保护仍在；保存/传输/Run 的原安全规则与 Service iframe 稳定性不回退；1440px 和 360px、键盘状态可达。
- 真实 Core / CLI / Docker：修改现有 real-core 验收的主链路，用户动作后由页面自行到终态，不能以测试端等待加 page.reload 补偿刷新。保留同一 Work 上启用与已显式禁用 Service 的定义及 workspace 哨兵数据；Stop 后核对其受管 agent/service/helper 无运行资源、运行/文件新请求被 Core 拒绝；显式 Start 后核对启用 Service 恢复、禁用项仍禁用、文件内容保留、UI 对应状态一致。
- 真实 Delete 单独使用该测试 installation 创建的可丢弃 Work，通过 UI 接受删除后核对列表移除及原 ID 终态，不删除用户 Work。
- 真实检查不能用 mock 覆盖 Core 结果；可控制的延迟/故障由受控测试承担，并与真实执行证据分开。镜像、浏览器或权限缺失须列出未完成门禁，不能把跳过记成通过。

## Risks / Trade-offs

- [现有已知操作接口不提供全局当前 Operation] → 只保证当前身份已知 ID 的观察，歧义时显示关联详情；目标以 Core 元数据为准。
- [进行中每两秒读取增加请求] → 仅查询活跃/待同步对象，去重、最大四并发、有界退避、隐藏停止；不全量读取配置或所有历史 Work。
- [读取截止时间可能早于慢环境响应] → 十秒后只表示未确认并继续有限恢复，保留确认事实，不改变服务器执行结果。
- [移除噪声误删错误或释放锁] → 展示与协调分离；用未知结果和同对象冲突测试作为回归门禁。
- [真实执行发现 Core 故障] → 输出原 Operation、状态、标签和安全诊断证据，停止对应门禁，另行规划服务端修复，不以 UI 假状态通过本次验收。
- [另一个开发环境并行操作] → 独立端口、数据、凭证路径和 installation；镜像记录实际 identity，清理前核对归属，不使用全局 prune。

## Migration Plan

1. 修改 Desktop 源码与对应测试，保留现有认证和 CLI 已知操作接口；按任务逐项验证。
2. 构建 Desktop 并同步 Go embed，检查源码产物一致，再构建 CLI。记录精确测试结果、截图及剩余限制到已有交付文档。
3. 用户测试环境仅在用户要求部署时重启对应 Desktop CLI，装载新二进制资源；前端更新无需重启 Core。规划阶段不动当前 tmux 服务。
4. 回退时恢复上一份 Desktop 源码/embed/CLI 二进制；没有服务端数据或 Work 包迁移。回退不取消已接受操作，重新打开后仍查询真实状态。
