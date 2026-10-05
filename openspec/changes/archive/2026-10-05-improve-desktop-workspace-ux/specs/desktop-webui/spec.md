# Spec Delta

## MODIFIED Requirements

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、Known operations、Operation/snapshot 查询、清除已完成记录 |

收到原 Operation/Run acceptance SHALL 立即展示其 ID、对象及 Accepted，不能等待后续 Work、列表、日志或配置读取才展示。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用目标内容区骨架、Loading files / Loading conversation 等就地状态及 busy 语义满足等待反馈，不插入统一检查条。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。
#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** 原 ID 和 Accepted 已可见，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

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

### Requirement: 本地授权初始化与恢复形成闭环

**Identifier:** DWUI-014

Desktop SHALL 在初始化期间立即显示中性的工作区外壳、Opening workspace… 与可访问的等待状态，并核验已有浏览器本地会话；核验未完成前不得展示私有 Work 内容、保存的 Core 身份或可执行的账号表单；已有会话有效时使用真实的会话/CSRF，忽略失效或已使用的启动 ticket，不再次兑换、不清理有效登录。无有效会话时才能兑换本次启动 ticket，并在提交前移除地址栏中的票据；兑换后以实际会话核验结果进入账号登录或 Works。不得持久保存票据、通过复制普通链接携带票据或仅凭成功兑换响应宣称账号已登录。

本地授权缺失、过期、票据失效和 Cookie 无法保留 SHALL 显示 Browser access required；说明本地浏览器尚未获准连接 CLI，提供 Check browser access、Copy reopen command 和当前端口的 `piwork-cli desktop open --port <port> --no-open`。还 SHALL 说明 `piwork-cli desktop logout --port <port>` 可以从同一系统用户的终端清理该实例平台登录。恢复页不指示在已占用端口直接再启动 Desktop。CLI 确认不可达时显示 Desktop connection unavailable、只读重试及启动方向，区别于 Core 不可达。

初始化/手动检查的 GET SHALL 去重，检查结果有归属和确认反馈；初始化失败仍允许显式检查，不能依赖未启动的后台定时器恢复。本地 CSRF 拒绝后 SHALL 先只读核验当前会话：本地会话有效则更新 CSRF 并允许用户明确重新提交，不能自动重发原 mutation；无有效会话才转本地授权恢复。兑换响应丢失时先检查 Cookie/会话，不自动重放 ticket；有效票据兑换后 Cookie 未保存时显示具体恢复说明，不无限重试。

初始化成功 SHALL 以真实登录页面或 Works 内容自然承接，不保留浏览器检查成功条。初始化超过十秒仍未确认时 SHALL 在原等待区说明仍在验证连接，不制造进度百分比或无限遮挡返回/恢复。初始化失败 SHALL 转入下述明确的授权或连接恢复状态；普通进入与用户显式 Check browser access 的确认反馈 SHALL 分开。
#### Scenario: 旧链接与有效 Cookie 同时存在
- **WHEN** 已授权浏览器再次打开含已使用、过期或上次进程 ticket 的链接
- **THEN** 使用本次进程确认有效的本地会话，正常进入账号登录或 Works，旧 ticket 被移出地址栏，没有 bootstrap 重放

#### Scenario: 延迟打开或另一浏览器重放启动链接
- **WHEN** 无有效 Cookie 的浏览器打开过期或已被另一浏览器使用的启动链接
- **THEN** 显示 Browser access required 和当前端口的重新打开命令，没有失效登录表单，不获得保存的 Core 身份

#### Scenario: CLI 重启或浏览器 Cookie 被清除
- **WHEN** 原授权失效但本地 CLI 已运行，用户执行重新打开命令并使用新链接
- **THEN** 新授权可进入账号登录或已保存会话对应的 Works，无需重启 Core/Work，旧授权仍不可使用

#### Scenario: 检查与兑换响应不确定
- **WHEN** 会话查询暂时失败、兑换响应丢失，或浏览器没有保存 Cookie
- **THEN** 分别提供只读检查、按实际 Cookie 核验或 Cookie 无法保留的说明；不自动重放登录或票据，不虚构授权/登录成功，检查入口仍可用

#### Scenario: CSRF 拒绝与晚到的检查结果
- **WHEN** 平台修改被本地 CSRF 校验拒绝，或旧检查在身份/页面变化后返回
- **THEN** 只读核验可恢复有效会话的提交能力但不重发修改，旧结果不覆盖新身份、草稿或释放新锁

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。用户显式 Refresh/Check 且结果未变化时 SHALL 在原刷新/检查入口附近给一次 Refreshed / Up to date 等简短确认，不新增通用 Checked/Confirmed 条；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

Work 列表、Work、Services、Files、Settings、Session、详情和深链接首屏 SHALL 按同一规则呈现；进入路径本身不要求用户先点击检查。已有内容更新 SHALL 保留可读内容和取得时间，首次读取无数据时显示真实骨架，成功空集合才进入空态。后台读取不得插入通用 pending 条；需要影响准入的真实降级或不可达 SHALL 仍在所属模块持续呈现。
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

### Requirement: Chat 模型选择遵守下一次受理语义

**Identifier:** DWUI-MODEL-001

Desktop SHALL 在现有 Chat Box 输入框底部提供当前 Session 的下一次手动 Run Model 与 Thinking 紧凑选择，来源为 Go Core 与实际 SDK 共同确认的可用模型，包含 Use Work default。模型与 Thinking SHALL 作为完整设置对自动保存，不要求另按 Save model；保存 Session 偏好 SHALL 不触发 Apply、重建 Session、取消 Run 或立即发送消息。已受理 Run 的实际模型与 Thinking SHALL 保持不变；自动请求 SHALL 使用该 Run 受理时 Work active 默认模型及其兼容旧行为的 Thinking，不继承手动 Session 偏好。选择器及详情 SHALL 不公开密钥、私有路径或绑定凭证。

加载、保存、发送、错误和恢复 SHALL 沿用 DWUI-011、012、014、017、018、019 的对象归属、即时反馈、身份隔离及原 ID 规则。偏好保存尚未确认时 SHALL 不受理依赖该新选择的发送；失败保留草稿与已确认偏好，不将 UI 临时选项当作服务端事实。失效模型 SHALL 明确阻止新受理并提示选择可用项，不静默换模型。模型或偏好读取晚返回 SHALL 不覆盖切换后的 Work/Session；已受理的提交即使刷新失败也 SHALL 保留 Run ID 和 submissionKey，不重发 prompt。

偏好保存响应丢失或无法确认是否已写入时 SHALL 显示结果未知并保留原 Session 和所选值；Check chat settings SHALL 读取原 Session 的实际完整偏好，不重新发送 PATCH 或 prompt。确认当前偏好之前 SHALL 禁止依赖该保存结果发送；查询失败保持未知和草稿，明确拒绝且可证明未写入时才恢复原已确认偏好。

Thinking 可选档位 SHALL 仅来自当前真实模型的能力，不显示硬编码的通用档位。不能选择 Thinking 的模型 SHALL 显示 Off 和不可用原因；模型切换需要调整不兼容档位时，SHALL 在保存前显示目标模型提供的默认档位及调整说明，保存返回值才成为确认事实。模型覆盖列表为空但 Work 默认已确认可用时 SHALL 仍允许选择默认及发送。当前已保存值不可用时 SHALL 明确要求用户选择，不能静默回退。

快速连续选择 SHALL 在原 Session 内按完整设置对协调；上一请求未确认时保留最新选择，不并行提交可能互相覆盖的保存。发送 SHALL 等待最新选择可靠确认；未知结果阻止后续自动保存和发送，重查得到实际完整设置后由用户明确处理尚未保存的选择。切换 Work/Session 不丢草稿，不用晚响应覆盖新对象，也不为界面切换自动提交未开始的保存。

尚无 Session 时 SHALL 允许在 Work 的输入草稿上选择设置，说明用于新 Session；用户显式 Send 或 New session 才创建一次 Session并确认设置对。创建或保存结果未知时保留原身份、提交键和草稿，按原结果只读核对，不再次创建或发送。当前 Run 占用期间下一条设置可变更，但发送仍遵守单 Work 单活跃 Run。

打开选择器 SHALL 不立即改变设置；只有明确选择才触发保存。控件、菜单和错误恢复 SHALL 支持键盘且保持输入草稿。新聊天能力缺失时 SHALL 保留既有基础聊天与模型能力，Thinking 入口说明此 Work 不支持，不将缺失能力等同于 Off 已保存。
Model、Thinking 与 Enter/Send SHALL 组成输入框内同一底栏，宽度足够时同行、等高并垂直居中；长名称不挤走发送，360px 允许合理换行且选择器、弹层与错误恢复可达。打开选择器不修改，Esc 取消并返回触发控件；/model 与 /thinking 打开同一真实选择入口，不只停在未打开或不可用控件。

模型和档位 SHALL 以固定 Pi SDK 的已确认能力结合 Core 准入为准，不为让 Thinking 可点击而补通用档位。能力未确认、真正不支持、新契约缺失分别说明；已确认支持多个档位时必须可直接选择、保存并用于下一次真实请求，SDK/配置修订不成为默认模型标签。

#### Scenario: 当前执行中修改下一次模型
- **WHEN** 当前 Run 使用模型 A，用户保存当前 Session 的模型 B 偏好
- **THEN** 当前 Run 仍显示 A，下一次新手动 Run 在偏好保存确认后使用 B，Session 不变

#### Scenario: 偏好保存失败
- **WHEN** 用户选择 B，但保存返回鉴权或服务错误
- **THEN** 显示归属该 Session 的错误，草稿保留，后续发送不假定 B 已保存

#### Scenario: 默认与自动处理
- **WHEN** 用户将 Session 设为 Use Work default，随后有 Service 自动请求被受理
- **THEN** 手动和自动 Run 各自显示其受理时的真实模型，旧历史不随默认值变化

#### Scenario: 偏好保存响应丢失
- **WHEN** 保存可能已写入但响应丢失，随后查询也暂时失败
- **THEN** 显示未知结果并保留草稿，发送暂不可用；按原 Session 查询成功后显示其真实偏好，不重复 PATCH 或自动提交消息

#### Scenario: Thinking 与模型原子确认
- **WHEN** 用户切换模型并选择该模型支持的 Thinking，保存响应被延迟
- **THEN** 控件显示最新完整设置与保存中，输入仍可编辑，发送暂不可用；可靠确认后下一次 Run 显示真实模型和 Thinking

#### Scenario: 快速选择与跨 Session 晚响应
- **WHEN** 用户连续选择多个设置后切到另一 Session，原请求晚返回
- **THEN** 原设置只归属原 Session，当前控件和草稿不受覆盖；没有并行保存或自动向新 Session 发送

#### Scenario: 没有模型覆盖或没有 Session
- **WHEN** 已确认可用的 Work 默认模型之外没有模型，且用户还未创建 Session
- **THEN** 默认模型仍可用于草稿设置，显式发送才建立并确认一个 Session，未知响应不引发第二次创建

#### Scenario: 模型变化导致 Thinking 不兼容
- **WHEN** 用户从支持 High 的模型切换到仅支持 Off 的模型
- **THEN** 控件明确显示调整为 Off 的原因并保存完整设置对；当前 Run 的 High 保持不变，未确认前不发送

#### Scenario: 输入底栏对齐
- **WHEN** 用户在宽屏输入，或在 360px 选择长名称模型
- **THEN** 宽屏选择器与 Enter/Send 同行等高并垂直居中，窄屏所有必要控件与状态可达且无整页横向滚动

#### Scenario: Thinking 直接调整与网页命令一致
- **WHEN** 当前模型支持多个 SDK 档位，用户点击 Thinking 或执行 /thinking
- **THEN** 同一实际选择入口打开，能选择并保存受支持值，取消保留草稿，选择不立即发送 Run

#### Scenario: 设置菜单优先关闭
- **WHEN** 用户在 Focus chat 打开 Model/Thinking 菜单并按 Esc
- **THEN** 仅关闭菜单并恢复焦点，不同时退出 Focus，未知与保存中的提交保护仍成立

## ADDED Requirements

### Requirement: 工具过程按调用合并并默认折叠

**Identifier:** DWUI-ACTIVITY-001

Desktop SHALL 将同一 Run 内同一工具调用的开始、结束、保存历史及重连事件合并为一个调用项，不用工具名作为身份。相邻工具项 SHALL 组成默认折叠的 Activity；不同 Run 和被正文隔开的工具段不合并。工具开始显示进行中，可靠结束显示成功或失败；未保存结束事实或观察中断时显示未确认，不用 Run succeeded 猜测每个工具成功。失败数量与可理解错误摘要 SHALL 在折叠状态可见，必要的执行诊断不被隐藏。

展开 SHALL 展示工具名、状态和可取得的结果，文本结果超过 64 KiB 时提供截断标记；非文本结果说明结果类型，结果缺失说明不可取得，不虚构输出、不新增完整参数展示。工具文字是用户数据 SHALL 安全按文本呈现。空工具集合 SHALL 不显示 Activity；流式正文、工具段、后续正文和最终回答 SHALL 保持原发生顺序，不重复最终答案。

用户展开/折叠选择 SHALL 在同一 Work/Session 的重绘、事件更新和重连中保持；切换布局不得改变选择。手动上滚阅读时事件不抢滚动，只有用户处于底部或明确跳到最新时跟随。正文没有历史工具关联时 SHALL 保留真实旧历史，不能按时间或工具名猜测合并。关闭详情、折叠 Activity 或断开观察不会取消 Run。

#### Scenario: 开始与结束事件
- **WHEN** 同一工具开始后收到结束事件，随后收到重复事件
- **THEN** Activity 调用数量保持一，状态从进行中变为真实终态，没有第二条重复工具消息

#### Scenario: 工具与正文交错
- **WHEN** Run 先产生正文，再产生连续工具，然后继续正文
- **THEN** 正文保持原位置，连续工具占一个折叠段，后续正文独立可读，工具数量与顺序正确

#### Scenario: 折叠失败与观察中断
- **WHEN** 折叠段包含失败，或工具开始后观察断开且未取得结束事实
- **THEN** 摘要分别显示失败或未确认，原 Run 仍可查询，不能把中断描述为已取消或工具成功

#### Scenario: 重新打开与阅读位置
- **WHEN** 用户展开历史 Activity、向上阅读，随后重连或隐藏并显示 Chat
- **THEN** 调用和正文不重复，展开选择与阅读位置保持，长结果有截断说明且内容不作为 HTML 执行

### Requirement: 基础 slash command 在输入位置发现和确认

**Identifier:** DWUI-COMMAND-001

Desktop SHALL 在 Chat Box 的首个非空白字符为 /、且光标处于命令名时打开可搜索命令菜单，包含网页动作 /new、/resume、/model、/thinking、/settings，以及当前 Work active 已加载 Skill 与 Prompt Template。资源命令 SHALL 使用 Pi 形式 /skill:<name> 和 /<template-name>，显示名称、简短说明及类别，不暴露路径、正文、密钥或内部版本。菜单空结果、加载、读取失败与功能不支持 SHALL 分开；命令目录未确认时不允许执行资源命令，已有普通文本输入仍可使用。

上下键 SHALL 移动选项，Enter/Tab 选择并填入命令，不在选择时执行；参数按原输入保留。光标离开命令名后输入按普通参数编辑，Esc 关闭菜单并保留草稿且不向父布局传播，中文输入法组合期间 Enter 不选择或提交。用户后续显式 Enter/Send 才执行已确认命令；Shift+Enter 保持换行。菜单关闭或没有匹配项的未知命令 SHALL 提示不可用并保留输入，提供明确 Send as text；该动作按字面文字发送，不能静默执行扩展命令或模板。

/new SHALL 创建并选择一个新 Session，其余 Session 的未发送草稿保留；/resume 打开当前 Work 的 Session 选择器，选择后加载真实历史；/model 与 /thinking 打开对应设置选择器；/settings 按原设置与返回规则打开当前 Work Settings。这五个网页动作 SHALL 不提交模型 Run，不把命令文字保存为用户对话消息；不接收参数，额外参数显示字段错误且保留草稿。执行成功只消费当前命令草稿，其余 Session 草稿不变；失败、未知、取消或仅关闭选择器时保留待处理输入，不自动执行后续动作。

当前 Session 正在运行时 /new、/resume 仍可导航/创建；任何后续发送仍遵守单 Work 单活跃 Run。网页动作受既有对象等待和授权规则约束。资源命令与当前 Session context 不兼容、在目录更新后消失或被不支持的扩展命令占用时 SHALL 明确拒绝，不能自动换 Session、运行扩展或降级成普通文字。选择目录项不构成执行授权。

Service identity 选项 SHALL 在资源命令输入期间明确说明不附加到命令，恢复普通输入时保留原选项；资源命令及参数发送为原命令文本，不把 Service 身份后缀误作模板参数。不读取 Service 网页数据。

#### Scenario: 搜索并选择资源命令
- **WHEN** 用户输入 / 并用键盘选择一个 Skill 或模板
- **THEN** 菜单显示类别和说明，输入框只填入可编辑命令，没有 Run；再次明确提交才执行一次

#### Scenario: 网页命令导航
- **WHEN** 用户确认 /model、/thinking 或 /settings
- **THEN** 打开当前 Work 的实际网页入口，没有模型提交；取消保留输入，完成后回到正确位置

#### Scenario: 新会话与恢复
- **WHEN** 用户执行 /new 或从 /resume 选择原 Session
- **THEN** 分别创建一个可核对的新 Session 或恢复同一历史；各自草稿保持，当前执行不被隐式取消

#### Scenario: 无资源、目录失败或不支持
- **WHEN** 当前 Work 没有 Skill/模板，资源查询失败或 Agent 不支持基础命令契约
- **THEN** 网页动作仍按自身能力可用，资源区分别显示真实空态、重试或不可用原因，普通文字仍可编辑

#### Scenario: 未知或失效命令
- **WHEN** 用户提交未知命令，或菜单中的命令在提交前失效
- **THEN** 保留命令和参数并说明原因，没有隐藏模型提交或扩展调用；只有明确 Send as text 才按字面发送

#### Scenario: 输入法、关闭菜单与参数
- **WHEN** 用户组合中文输入、Esc 关闭菜单或编辑模板参数
- **THEN** 输入法 Enter 不提交，Esc 只关闭菜单，参数完整保留且不附加 Service 身份，草稿不被自动清空

### Requirement: Service 专注视图与浏览器全屏有独立且可恢复的状态

**Identifier:** DWUI-FOCUS-001

Desktop SHALL 在可嵌入 Service 的工具栏提供 Focus，进入填满当前浏览器内容区域的 Service + Chat 布局，隐藏常规导航。Hide chat / Show chat 在同一专注布局切换仅 Service 或 Service + Chat，聊天仍为当前 Session。Exit focus SHALL 始终可达并恢复进入前的常规区域、对象选择、草稿、阅读位置和焦点来源。没有可嵌入 Service、尚未取得入口、明确禁止嵌入或入口失败时 SHALL 给出对应等待/原因与既有独立打开入口，不将 Focus 变成绕过嵌入限制的方法；可保留当前视口的未确认预览仍可进入 Focus，并继续显示真实未知状态。

Focus chat SHALL 从常规区域或 Service 专注布局放大同一 Chat；仅 Chat 头部持续保留 Restore layout 与 Exit focus。恢复回到放大前常规区域或专注布局，退出直接恢复首次进入专注前常规区域。Service + Chat、仅 Service、仅 Chat 共用返回所有者，内部切换不覆盖最初返回目标；普通 Chat 模块仍有正常导航，不等同于 Focus chat。

仅因 Focus chat 及恢复改变布局 SHALL 保持同一 Service iframe/祖先和 Chat 节点连接，隐藏而不卸载、不改 src、不重取入口；正常跨模块导航仍按原规则处理。用户明确切换 Service/端口或 Session 后返回保留该新选择，失效对象给原因且仍可退出。退出与恢复以现有图标按钮和准确英文 tooltip/无障碍名表达，不藏在溢出菜单。

Full screen SHALL 是专注工具栏中的额外、明确用户动作，使用当前同一视图。浏览器不支持、拒绝或退出全屏时 SHALL 保留可用的专注布局并给出就地说明。浏览器 Esc 退出全屏只取消全屏状态，不自动退出专注或丢失数据；Exit focus 在本视图全屏时先请求退出，再恢复常规布局。普通专注视图中，外壳取得键盘事件且没有优先菜单/弹层时 Esc 可返回；跨源应用内部键盘事件不能保证传给外壳，始终保留返回按钮。

进入、隐藏 Chat、退出全屏和返回 SHALL 不重建同一 Service/端口视口、不重置 Chat、不中断 Run 观察、不改原访问 origin、不产生 Apply/Start/Stop。仅在明确选择另一 Service/端口或服务真实失去资格时沿原访问规则转换，状态变化不伪造应用成功。专注仅为当前页面临时状态，不写入 Work 配置，不复制为另一个 Session，不影响独立窗口。

窄屏无法同时容纳 Service 与 Chat 时 SHALL 用可关闭的 Chat 覆盖层；Show chat 打开同一会话，关闭恢复 Service，焦点按来源恢复。隐藏 Chat 时 SHALL 以紧凑提示表示当前 Run 进行中、失败或观察未知，不重复自动弹出 Chat。弹层、菜单及覆盖层 SHALL 遵守明确键盘优先级和可见焦点；360px 下返回和显隐动作仍可用。

#### Scenario: 同一应用和对话切换布局
- **WHEN** Service 页面已填写未保存内容，Chat 有草稿，用户进入 Focus、隐藏并显示 Chat、返回
- **THEN** 同一 iframe 没有再次文档加载，应用输入保留，Session、草稿、展开选择和阅读位置保持，没有新提交或停止请求

#### Scenario: 浏览器全屏失败与 Esc
- **WHEN** 用户请求全屏被拒绝，或成功后按浏览器 Esc
- **THEN** 前者解释无法全屏且专注仍可用，后者回到专注；Exit focus 始终能恢复常规布局

#### Scenario: 服务不可预览或执行仍进行
- **WHEN** Service 无入口/禁止嵌入/真实停止，或 Chat 隐藏期间 Run 仍在执行
- **THEN** 显示真实访问原因和回退，隐藏聊天不改变 Run；进行中、失败和未知可从紧凑提示辨认

#### Scenario: 窄屏及弹层键盘
- **WHEN** 用户在窄屏显示 Chat 并打开命令菜单，再按 Esc
- **THEN** Esc 先关闭菜单，再关闭 Chat 覆盖层，返回按钮仍可达；浏览器全屏退出与布局返回不混为同一动作

#### Scenario: 从专注进入其他模块
- **WHEN** 用户在专注中的 Chat 执行 /settings，或选择打开 Files
- **THEN** 先恢复常规布局再打开目标，按原返回位置回到 Work；恢复专注本身不重载视口，模块导航继续遵守原容器规则

#### Scenario: Focus 与 Focus chat 完整往返
- **WHEN** Service 有未保存表单且 Chat 有草稿，用户依次进入 Focus、Focus chat、Restore layout、Exit focus
- **THEN** 每一步有可见出口，恢复回原专注布局，退出恢复常规导航，同一 iframe/Session、表单、草稿、阅读位置及 Activity 展开保持，无重复文档加载或业务请求

#### Scenario: 仅 Chat 直接退出
- **WHEN** 用户从专注布局进入仅 Chat 并直接 Exit focus
- **THEN** 一次退出恢复最初常规区域，不需先恢复 Service 工具栏或固定跳往 Services

#### Scenario: 返回目标随来源确定
- **WHEN** 用户从常规 Files、常规 Chat 或仅 Service 专注进入 Focus chat 并恢复
- **THEN** 分别恢复原常规区域或仅 Service 专注布局，当前 Session 与未保存内容保持，重复放大不丢返回目标

#### Scenario: 仅 Chat 的全屏与异常出口
- **WHEN** 仅 Chat 中菜单打开、浏览器全屏，或 Work/Service 失去资格
- **THEN** 菜单、浏览器全屏与布局遵守逐层键盘返回，Exit focus 始终可见，异常原因按真实资格表达，退出不发业务修改
