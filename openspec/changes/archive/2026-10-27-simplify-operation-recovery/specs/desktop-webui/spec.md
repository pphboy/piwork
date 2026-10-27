## MODIFIED Requirements

### Requirement: 以统一语言组织可操作的 Work 工作区

**Identifier:** DWUI-002

Desktop SHALL 落实 DUL-001—007、DUL-010、DUL-016 的对象、容器、英文文案和 Serve 浅色视觉规则。Work List SHALL 独立展示搜索、New Work、Import、账号、按需出现的无可见 Work 任务提示与对齐的状态/动作列；原操作按所属任务查找，不提供全局 Known operations 入口。打开 Work SHALL 直接进入专属面板，无跨 Work 侧栏或强制概览；Service/Files/Chat 为同级入口，Settings 明确可达。

首次进入且无当前身份的有效上次区域时，可用 Service SHALL 为默认主区域，同一 Session 的 Agent 输入保留在辅助栏；首次进入且无有效上次区域时，无可用 Service 且对话准入成功则聚焦 Chat。停止状态 SHALL 展示 Start、配置、Export 与历史保留提示，不新读历史。切换区域 SHALL 保留当前 Service/端口、Session 和本页面非敏感草稿；不承诺任意应用内部未保存表单的恢复。所有列表 SHALL 区分加载、真正空集合、错误和带时间的旧内容。

共同颜色/字阶/间距/控件 SHALL 可集中修改；360px 无整页横向溢出，长名称和技术标识可完整读取/复制，危险/编辑弹层按 DUL-007 管理焦点及未保存确认。交付 SHALL 提供原型 36 帧/CLI 能力矩阵到实际界面与验收记录的对应关系。

同一有效身份的当前页面生命周期内，重新进入 Work SHALL 优先恢复上次明确选择的 Services、Files 或 Chat，以及仍存在且有权访问的 Service/port、Session、文件目录和已打开文件；首次进入才使用默认区域规则。恢复目标的读取使用该区域稳定外壳，不先强制切往 Services。目标失效 SHALL 说明原因并提供该模块可用回退，不能因后台加载晚到覆盖用户的新选择。离开脏文件/配置仍需既有确认；不将草稿或选择持久化到另一身份。

最后确认可用的 Work/Service 仅遇到状态观察网络错误、超时或暂时服务错误时，Desktop SHALL 保留同一已挂载应用视口与工作区，标记状态未确认及安全重查入口；不能因该读取错误卸载再创建 iframe、清除草稿或抢焦点。保留画面不表示刷新授权或确认 Ready，不扩大新动作准入；已确认停止/删除、停止目标接受、真实资格撤销及身份失效仍按原规则限制能力和撤销访问。

Desktop SHALL 按主流程、对象管理、全局管理分层：Ready Work 优先直接 Open，Stopped 保留 Start；Stop 与 Work information 在所属 Work 更多菜单；About Piwork 在账号下拉，Known operations 不作为账号菜单入口。Files 空选择提示不占独立行，批量动作在已有工具栏；Service/Agent请求入口使用有可访问名称的就近图标，分别保留当前Service与全Work作用域。账号下拉外侧关闭不受背景草稿/任务阻碍，不扩大其他确认窗规则。

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

### Requirement: 已知操作恢复不形成隐式任务队列

**Identifier:** DWUI-010

Desktop SHALL 在 Work、Service、Apply、Packages、Import、Export 所属任务上下文提供原 Operation 详情、按 ID 查询和只读恢复；没有可见 Work 的创建、导入及已移除 Work 任务在 Works 列表提供必要的临时提示。账号菜单不提供 Known operations，全局操作列表和操作中心不作为替代入口。已接受操作持久记录仅含 Core/用户归属、类型、相关身份 ID 和时间；页面重载后重新查询原对象，不能称为全局历史。记录不得包含凭证、提示词、文件正文、包字节或来源秘密。未知结果 SHALL 保留最后确认时间、原 ID 和 Check status；无 Operation ID 的未知提交不能自动再发，提示核对对象状态。

多窗口与观察重连 SHALL 不导致重复 mutation。请求进行时防重复点击，关闭普通详情仅结束该详情展示/读取观察，不取消远端执行；已经明确授权且仍有效的导出交付按 DWUI-009/013 继续；有幂等键的提交保持该次键且不用于新意图。读失败采用有界退避，鉴权失败进入恢复，404/410 不无限重试。用户可隐藏已完成提示或清除本地显示记录，不改变 Core 对象、未完成任务的恢复、待同步依据或未知修改保护。

#### Scenario: 删除后重载
- **WHEN** Delete 已接受且列表已无该 Work，用户刷新页面
- **THEN** 从当前身份已知记录恢复原 Operation，仍可查看清理结果

#### Scenario: 提交响应丢失
- **WHEN** 控制请求已发送但未取得 Operation ID
- **THEN** 显示结果未知并引导核对状态，不自动再次提交，不虚构 ID 或失败终态

#### Scenario: 多窗口观察同一任务
- **WHEN** 两个窗口恢复同一个已知 Operation
- **THEN** 二者只查询该任务，无新增 mutation，切换身份后不读取旧身份记录

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、所属任务的 Operation/snapshot 查询、已完成任务提示关闭或本地记录移除 |

收到原 Operation acceptance SHALL 立即展示对象及 Accepted，并使原 ID 在所属任务详情中可按需查看和复制，不能等待后续 Work、列表、日志或配置读取才展示。收到原 Run acceptance SHALL 立即展示其 ID、对象及 Accepted。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及固定的局部三点、Loading files / Loading conversation 等就地状态及 busy 语义满足等待反馈，不插入统一检查条。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

覆盖 SHALL 同时包括本地/托管初始壳和会话检查、初次/手动Core连接检查、Session模型与Thinking读取/自动保存、Slash资源目录、图片草稿检查/历史图片、Chat Activity、默认Core偏好和About读取等独立状态。每次真实Core连接检查 SHALL 有可见的检查中及结束/错误状态并对同目标去重；文案为连接或检查Core，不表示Desktop会启动Core。检查失败转为准确恢复提示，不因此新增持续探测或自动进入行为。后台静默读取不逐次闪动，Files/Chat/Service的独立收敛、既有iframe及阅读锚点保持。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** Accepted 已可见且原 ID 可按需查看，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

#### Scenario: 读取不是空数据
- **WHEN** 用户打开 Work、Files、Settings、Session 或日志且请求尚未返回
- **THEN** 目标与读取状态可见，旧内容标记为最后已知，未确认列表不写成空集合/零计数；成功空集合、404 和读取失败各有不同的下一步

#### Scenario: Run 提交与请求取消
- **WHEN** 用户 Send 或 Cancel run，接受响应被延迟
- **THEN** 对应输入/Run 上显示 Submitting message 或 Requesting cancellation，保留草稿/原 Run；接受后显示真实 Run 状态，取消与成功竞争以真实终态为准

#### Scenario: 保存确认与读回分离
- **WHEN** 文件 PUT 或配置保存已被可靠确认，随后版本/配置读取失败
- **THEN** 已确认写入事实保留，界面明确版本/当前配置未确认，草稿和新编辑不丢失；不重复写入、不以旧时间授权下一次覆盖、不暗中 Apply

#### Scenario: 未变化的检查与快速完成
- **WHEN** 手动查询成功但返回相同状态，或请求立即完成
- **THEN** 查询确认时间/简短结果可辨，快速完成不增加人为等待；菜单与复制继续使用既有即时结果

#### Scenario: 自动Core检查有可辨结果
- **WHEN** 页面已完成浏览器会话检查，正在首次查询Core而请求尚未完成
- **THEN** Core连接区显示正在检查及三点，不能提前显示确定Connected；成功/错误后结束该等待，离线和Runtime未就绪分别说明，不声称正在启动Core

#### Scenario: 通用动作之外的等待不遗漏
- **WHEN** 响应设置自动保存、图片读取、Activity执行、默认Core偏好或About请求尚未确认
- **THEN** 各自原对象显示统一三点及真实阶段，完成/失败后停止；现有内容、iframe、草稿和阅读位置保持，不为此改写业务状态或重复发请求

#### Scenario: Works 首次读取使用稳定骨架
- **WHEN** 当前身份尚未确认 Works 列表，初次 Core 检查或 Works 读取正在进行
- **THEN** SHALL 立即显示对应列表结构的静态骨架及可访问加载状态，不呈现空白框或已确认零条；保留所属 Core 检查三点。成功空集合及实际错误后骨架结束，有旧列表刷新时不替换旧正文，减少动态效果下保持可辨

#### Scenario: Works 初次错误不重复提示
- **WHEN** 未确认列表的初次读取失败，随后用户重试
- **THEN** SHALL 仅在中间错误态显示纯文本原因和 Retry loading，不再重复顶部黄色刷新警告；重试在原刷新槽显示局部三点并防重，终态停止。已有确认列表（包括确认空集合）的刷新失败仍保留对应错误反馈，不抹掉正文或恢复方向

#### Scenario: 导出明细长身份仍可读
- **WHEN** Starting export 的 Details 展开且 Stop/Export Operation、Snapshot 身份较长，用户处于宽屏或360px窄屏
- **THEN** SHALL 保留完整身份、原链接和状态，值列宽度与行高随内容适配，长token安全换行且不互相重叠或遮盖后续行；默认按需披露及停止/导出/暂停/Hide/Pending语义不变

#### Scenario: Session选择器紧凑且选中状态独立
- **WHEN** 用户在当前Work打开Sessions，列表包含短名称、长token或正在运行的已选Session
- **THEN** SHALL 使用局部Popover呈现，顶部New session与列表有明确间隔且不抢占选择层级；行高可随完整名称增长，状态不挤压名称、选中勾不被Run徽标替代，宽/360px及短视口不发生横向溢出或焦点遮挡

#### Scenario: Session样式调整保留原交互与恢复
- **WHEN** 用户用鼠标或键盘切换Session、创建新Session、关闭选择器，或会话列表加载/失败/空集合
- **THEN** SHALL 保留当前Work作用域、原只读/创建请求及等待/unknown防重、Run不因切换停止；Arrow/Home/End只移焦点、Enter执行原选择、Escape恢复可用原触发点，读取锁暂不可用时沿用安全焦点回退；打开时优先聚焦并显示当前选中项；头部关闭保留而不重复footer Close，空/加载/失败保持区分与原恢复入口

## ADDED Requirements

### Requirement: 原操作在所属任务中呈现并恢复

**Identifier:** DWUI-OPREC-001

Desktop SHALL 在 Work 列表行和 Work 面板、Service 详情及管理区域、Settings 的 Apply 和 Package 区域、Import 与 Export 流程中，为对应任务呈现动作、目标、实际进度、失败或观察中断原因、只读 Check status 及原 Operation 详情。已可靠接受与执行终态 SHALL 分开；Work、Service 实际可用性、配置生效和浏览器落盘 SHALL 各依据其自身确认结果，不能由 Operation acceptance 或 succeeded 代替。

同一任务在所属上下文中已有等价进度或错误时 SHALL 合并为一处主要反馈，不额外叠加通用状态条。原 Operation 和 snapshot 技术 ID SHALL 可在该任务的次级详情中读取、复制，默认折叠；已知多个原任务 SHALL 能逐一查看各自结果，历史顺序或旧成功不得覆盖当前控制目标。关联恢复 SHALL 核实原 Core/账号、Work、任务类型和可确认的 Service 身份；缺少或无法确认归属时 SHALL 说明未确认，不将任务归到猜测的对象。

原 ID 查询 SHALL 在相关任务上下文中可达；Export SHALL 仍能按 snapshot ID 找回该 Work 的原快照并核验归属，不另建全局 Operation 列表、搜索页面或操作中心。操作详情、手动查询、重新登录及页面重载恢复 SHALL 只观察已知原对象，不因查看、关闭或重查自动提交业务操作。相关 Work 或 Service 读取失败 SHALL 与已确认的 Operation 终态分别呈现，并继续按既有同步和有界重试规则收敛。

#### Scenario: Work 启动接受后对象尚未就绪
- **WHEN** 用户在 Works 列表启动某 Work，Core 已接受原 Operation，但 Work 状态仍在准备或读取失败
- **THEN** 原 Work 行显示启动已接受或正在准备及只读检查，原 ID 可在详情中查看；不宣称已就绪、不发第二次 Start，读取失败不改写已接受事实

#### Scenario: Service 控制重载恢复
- **WHEN** 用户控制 Service 后重载，同账号已知记录包含原 Work、Service 和 Operation 身份
- **THEN** 查询并验证原任务后，在对应 Service 的管理区域显示真实状态及详情；不把另一个 Service 的结果当作该任务，也不再次发送控制请求

#### Scenario: Service 归属缺失
- **WHEN** 已知 Service 控制记录缺少可确认的 Service 身份，或读取结果与记录不匹配
- **THEN** 在已确认的所属 Work 范围说明原任务目标尚未确认并保留原 ID 查询，不按名称、时间或当前选择猜测归属，不解除无关对象的未知结果保护

#### Scenario: 新旧目标及多个操作并存
- **WHEN** 同一 Work 的 Start 被后来的 Stop 取代，两次原 Operation 依不同顺序返回
- **THEN** 两个原结果各自可查，当前目标与按钮由确认的较新事实决定；旧 Start 结果不能使 Work 再显示可运行，也不能清除 Stop 的同步义务

#### Scenario: 原快照按 ID 找回
- **WHEN** 用户从 Work 的 Export 上下文按 snapshot ID 找回先前的快照
- **THEN** 仅在原 Work 和权限匹配时显示该快照的状态、期限和原下载动作，不按列表顺序改选其他快照，不产生新的 Export

#### Scenario: 操作完成但对象读取失败
- **WHEN** 原 Stop 已确认为 succeeded，随后 Work 或列表确认失败
- **THEN** 保留 Stop 的成功事实，另外显示状态未确认及只读恢复；确认恢复后收敛 Work 和按钮，不重提 Stop 或要求用户刷新整页

### Requirement: 无可见 Work 的任务仍有临时恢复入口

**Identifier:** DWUI-OPREC-002

Desktop SHALL 在 Works 列表为当前身份已知但尚无可见 Work 的 Create、Import，以及 Work 已离开列表的 Delete 显示临时任务提示。提示 SHALL 表达已确认的动作、目标或目标未确认、实际状态、Check status 和原结果详情；多个任务按各自身份呈现且可逐一展开，不变成全局操作历史。Work 行出现并确认关联后 SHALL 将适用反馈归回该行；删除清理仍在执行或失败时不得因行消失而丢弃原提示。

临时提示与 Work 搜索条件及列表空态独立；列表读取失败 SHALL 保留最后可确认内容并说明未确认，不将读取失败当作没有 Work。无法确认对象归属或实际名称时 SHALL 使用可确认的通用任务名称，不从源包、旧列表或记录时间推测。Import 只有成功发布后才可显示已导入的 stopped Work；用户明确选择时才执行 Start and open。

进行中、失败和未知结果提示 SHALL 不自动消失；用户可关闭详情或收起提示，并可再次查看需处理的原任务。关闭或隐藏展示 SHALL 不取消执行、不删除未决恢复依据、不重新提交、也不解除未知结果保护。完成提示可由用户关闭，不形成累积的永久成功流水；无对象的完成结果在用户关闭前仍可查看。关闭动作不得影响导出流程中仍有效的既有单次交付意图。

#### Scenario: 导入未发布时重载
- **WHEN** Import 已接受且原 ID 已记录，但尚未发布 Work，用户关闭详情并重载同账号页面
- **THEN** Works 列表恢复该次导入的进度和原结果入口，不显示半成品 Work、不自动重新 Import；未确认名称时不猜测名称

#### Scenario: 删除后 Work 行消失
- **WHEN** Delete 已接受，Work 不再显示，而清理仍进行或失败，随后用户重新进入 Works
- **THEN** 列表保留对应原删除任务的提示、检查和详情；只依据 Operation 终态说明清理结果，不创建假的 Work 行或假撤销

#### Scenario: 创建结果尚未确认
- **WHEN** 创建已接受并保存原 ID，但 Work 首次读取尚未完成或暂时失败
- **THEN** 列表提供对应创建任务与原 ID 的只读恢复，不因对象读取失败宣称创建失败或再次创建；对象确认后反馈归回原 Work 行

#### Scenario: 搜索和列表失败不丢失任务
- **WHEN** 用户搜索使 Work 行不匹配，或 Works 列表读取暂时失败，同时存在尚无可见 Work 的已知任务
- **THEN** 未决任务提示仍可访问并标明确认状态；列表错误与真实空集合分开，不因搜索或一次读取失败推测 Work 已删除

#### Scenario: 收起和重新查看未决提示
- **WHEN** 用户收起进行中、失败或未知结果的临时提示，随后返回 Works 或展开提示
- **THEN** 仍能查看匹配原任务及其检查入口；远端执行、原 ID、对象同步义务和未知修改保护不受收起或关闭详情影响

#### Scenario: 导入完成后的用户动作
- **WHEN** 原 Import 确认成功，用户先查看结果，随后选择 Start and open
- **THEN** 显示 Core 确认的名称与 stopped 状态，查看不启动 Work；明确选择后只提交一次 Start，并在实际可用后打开，不再次 Import

### Requirement: 原任务详情显示真实安全诊断

**Identifier:** DWUI-OPREC-003

Desktop SHALL 保留并在所属任务详情中展示后端实际提供的安全错误码、失败阶段、消息、修复建议、可确认的关联标识和相关阶段结果；已授权且可实际关联的日志入口 SHALL 在对应 Work 或 Service 上下文提供。任务主要说明 SHALL 包含可理解的失败事实和安全下一步，技术标识作为次级诊断，未确认的服务端自然语言只作为安全诊断辅助信息。

诊断为空、旧字符串、字段缺失、不合法或不可取得时 SHALL 保留已确认的失败事实，明确说明更具体的原因或相关日志未提供，不推断根因、失败阶段、修复结果或另一对象的归属。日志继续遵守原权限、脱敏和有界读取规则；查看诊断和日志 SHALL 不触发控制、修复或重新执行。既有后端未记录的原因不因本变更的呈现而被补出。

#### Scenario: 已提供完整诊断
- **WHEN** 原 Operation 返回失败及安全错误码、阶段、修复建议与可关联日志
- **THEN** 所属任务显示可理解原因和下一步，详情保留各实际字段及有权限的日志入口；查看只触发读取，不提交控制请求

#### Scenario: 后端未记录根因
- **WHEN** 原 Operation 失败但错误为空、仅有通用消息，或没有某次凭证冲突的具体根因
- **THEN** 显示已确认失败及更具体原因未记录，不虚构凭证冲突、阶段或修复建议；已有合法安全字段仍可查看

#### Scenario: 日志不可用或无权访问
- **WHEN** 任务没有可确认关联日志，或当前用户无权读取对应日志
- **THEN** 界面说明日志不可用或提供合适的联系管理员方向，不显示未经授权的内容或将关联标识当作其他对象的链接

#### Scenario: 提交未知且未取得原 ID
- **WHEN** 请求响应丢失或已接受但本地记录明确保存失败
- **THEN** 分别显示未知及可用的原对象核对方向、或保留已接受事实和可复制 ID 并说明重载自动恢复限制；不伪造 ID、解锁未知修改或自动重发
