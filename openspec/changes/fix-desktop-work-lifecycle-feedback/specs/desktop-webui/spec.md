## ADDED Requirements

### Requirement: Work 生命周期以接受目标和确认状态共同呈现

**Identifier:** DWUI-016

Desktop SHALL 在 Work 列表行、Work 身份栏、生命周期状态页和原 Operation 详情中一致区分本次请求提交状态、已接受目标、Core 已确认 observed 状态与观察是否成功。`provisioning` SHALL 显示 Preparing，`starting`、`ready`、`degraded`、`stopping`、`stopped`、`failed` SHALL 分别显示 Starting、Ready、Degraded、Stopping、Stopped、Failed；确认 deleted 的 Work 不再作为可运行条目显示，真实未知值或未确认状态 SHALL 有检查入口而不默认 Ready。

Create/Start/Stop/Retry/Delete 接受后 SHALL 立即提供原 Work/Operation ID 和相应目标，例如 Start accepted 或 Stop accepted；后续 Work 查询缓慢时仍可查看原操作。界面 SHALL 保留最后确认状态并说明目标尚在执行，不把 acceptance 写成 Ready/Stopped/Deleted；进度仅显示已取得的状态和阶段，不生成固定百分比或未取得的执行步骤。细阶段缺失时 SHALL 显示 Starting Work / Stopping Work 等对象动作及执行状态，原始状态、ID、确认时间在详情可查。

列表与面板快捷动作 SHALL 使用同一准入规则：准备/启动中的运行目标允许显式 Stop；停止目标执行中只提供检查而不重复 Stop 或提前 Start；确认停止后可 Start，Export 还需 desired/observed 均 stopped 且无已知冲突。desired=running 的启动/恢复失败可 Retry，desired=stopped 的失败检查原 Stop，不改回运行。提交期间只锁该对象的重复及冲突入口，接受后释放提交锁，继续遵守未知结果保护与 Core 实际准入。

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

### Requirement: 生命周期观察与对象刷新独立收敛

**Identifier:** DWUI-017

Desktop SHALL 将原 Operation 状态查询、Work 元数据确认及必要的列表同步作为可分别成功或失败的只读步骤。自动观察、Check status、Operation 详情检查和恢复查询 SHALL 使用相同的结果处理规则；进行中的当前身份已知生命周期操作 SHALL 在列表与面板持续取得 Work 状态，而不是只在 Operation 终态后刷新。

Operation 达到 succeeded/failed/superseded 后，Desktop SHALL 继续完成所属 Work 的确认及必要列表同步；后续读取失败 SHALL 保留操作终态，显示 Work status not confirmed 或列表未确认及 Check status，不把读取失败改成操作失败，不丢失同步义务。读恢复成功后 SHALL 同时收敛状态和按钮；不得依赖用户整页刷新。手动查询先发现终态也 SHALL 触发同样同步。确认 deleted 的 Work 可经当前列表和既有对象读取缺失收敛，不把合法移除写成创建失败。

用户清空本地已完成操作历史时，Desktop SHALL 独立保留尚用于 Work/列表同步的原 Operation ID、已确认终态及其接受代次。移除历史展示 SHALL 不使已确认的原操作重新成为未决，不使 Work 永久停在 accepted 或保持错误的能力禁用。同步确认后 SHALL 依据匹配的终态解除对应接受意图并释放协调记录；旧代次的历史清理 SHALL 不解除新的控制目标或未知修改保护。

读取暂时失败 SHALL 有有界只读重试，耗尽后有显式恢复入口；鉴权失败进入既有登录恢复，明确 404/410 停止该 ID 的无限观察并保留可读原因。一个对象查询缓慢 SHALL 不阻止其他对象更新。隐藏页面停止周期读取，返回可见页面时确认当前事实；关闭详情或离开 Work 不取消远端操作，Works 列表仍观察所属已知操作。暂停原 Operation 观察不得取消远端执行或暗中重提请求。

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
- **THEN** 可见后从原身份及 ID 确认事实，列表中仍可找回活动操作；暂停/关闭/恢复均没有业务修改或远端取消

#### Scenario: 缺失对象、读取失败与空列表
- **WHEN** 列表读取成功为空、列表读取失败，或原 Delete 操作仍可查而 Work 不再存在
- **THEN** 分别显示真实空态、保留旧列表及读取恢复、或原 Delete 进度；不得以读取失败制造零 Work 或丢失 Delete 身份

### Requirement: 原生命周期操作恢复遵守身份及新旧目标顺序

**Identifier:** DWUI-018

Desktop SHALL 在创建接受、已有 Work 控制接受，以及同 Core/账号页面重载恢复后，将已知生命周期 Operation 与所属 Work 关联，供列表行、Work 面板和详情查询。恢复 SHALL 重新确认原 ID 的类型、对象和状态；多个历史或未决操作存在时提供相应原 ID 入口，不仅凭浏览器记录时间或 UI 文案将某历史结果认定为 Core 当前目标。不提供全局操作发现保证，未取得的当前操作不得虚构。

Work 当前事实 SHALL 以既有 Core 查询为依据；新的已接受目标和更高控制版本取得后，旧 Work/Operation 回应不得回退当前目标、重新开放停止中的交互或覆盖其他 Work/身份/草稿。Start 与 Stop 竞争时各自保留原 ID，旧操作的 succeeded/superseded 不能被投影成新 Stop 的结果。重复 GET 可合并，业务 POST 仍只由显式提交产生。

已知操作 ID 缺失或提交结果未知时 SHALL 继续遵守 DWUI-010、012 的原对象核对及禁止盲目重提规则；历史查询、无关操作查询与单纯隐藏提示不能解除未知修改保护。切换 Core/账号清理旧内容、观察及提示，晚返回不能污染新身份；同身份导航后可从已知操作找回已接受任务，不自动弹回旧详情。

接受响应明确报告本地原 ID 记录未保存时，Desktop SHALL 保留本页已接受事实和可复制原 ID，说明重载后的自动找回无法保证；不能将记录失败写成 Core 未接受或自动重新提交。

#### Scenario: 创建接受后关联原操作
- **WHEN** 创建返回新 Work ID/Operation ID，首次 Work 读取成功或暂时失败
- **THEN** 原 Operation 在当前身份可查询；对象取得后其行内检查和面板详情指向该原 ID，不另建操作或再次创建

#### Scenario: 重载恢复正在停止的 Work
- **WHEN** Stop 已接受且仍执行，用户重载 Desktop
- **THEN** 通过当前 Core/账号已知记录查询原 Stop 并关联所属 Work，显示最后确认事实与停止目标，Stop POST 不增加，其他账号记录不进入页面

#### Scenario: 多个历史操作和类型差异
- **WHEN** 同一 Work 有 Create、Start、Stop 的历史记录，包含接受时的英文名称和 Core 的规范操作类型
- **THEN** 正确识别生命周期动作并可查询各原 ID，当前目标来自确认事实，记录顺序或旧成功不能直接授予 Start/Export 或覆盖当前停止

#### Scenario: Stop 取代 Start 且旧读回晚到
- **WHEN** Start 已接受，随后 Stop 已接受，旧启动查询或旧 Work 快照在新停止目标/版本之后返回
- **THEN** 页面保持停止目标和对应按钮，保留两个 Operation，旧结果仅更新旧操作详情，不能重新显示当前已就绪或恢复运行交互

#### Scenario: 切换对象或身份后返回旧结果
- **WHEN** 用户切换 Work/Core/账号，旧观察或提交随后返回
- **THEN** 旧结果不打开旧弹层或覆盖新内容/草稿/锁；同身份已接受 ID 仍可在其原对象找回，新身份不能读取旧记录

#### Scenario: 未知提交与无关查询
- **WHEN** 生命周期请求结果丢失且无原 Operation ID，用户查询另一个 Work 或同 Work 的无关历史操作
- **THEN** 原未知结果保护仍存在，界面只提供匹配原对象的核对方向，不因成功读取或提示消失允许盲目重复提交

#### Scenario: 接受后本地记录保存失败
- **WHEN** Core 已接受创建或控制并返回原 ID，但 CLI 明确报告 localRecordSaved=false
- **THEN** 当前页面仍可观察并复制原 ID，说明重载自动恢复的限制；不声称操作失败，不发第二次创建或控制请求

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。用户显式 Refresh/Check 且结果未变化时 SHALL 在当前上下文给一次简短确认；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

#### Scenario: 多目录正常读取后不堆积
- **WHEN** 用户在同一 Work 依次打开根目录、apps、子目录，再返回根目录并切换 Services/Chat
- **THEN** 等待有局部读取反馈，完成后内容正常展示，没有 Checked/Confirmed 加 ISO 时间的状态条，没有跨目录成功记录堆积或背景读取 toast

#### Scenario: 手动检查未变化
- **WHEN** 用户显式刷新目录或检查 Work，成功结果与已有内容相同
- **THEN** 当前模块出现一次简短确认，三秒内消失且不重复累积；失败时有可操作错误而非成功措辞

#### Scenario: 写入成功、未知结果及读回失败
- **WHEN** Save 已确认、修改响应丢失，或原操作已确认而对象刷新失败
- **THEN** 分别提供简短保存确认、持续的未知核对入口、或确认结果与刷新未确认说明；短提示到期不改变提交保护或重放任何修改

#### Scenario: 详情关闭与应用稳定
- **WHEN** 进行中的生命周期详情关闭、反馈到期，或状态刷新时当前 Service 有未保存输入
- **THEN** 原 Operation 从所属 Work/已知操作仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用
