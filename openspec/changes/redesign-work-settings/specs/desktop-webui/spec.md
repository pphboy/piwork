# Spec Delta

## MODIFIED Requirements

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Work Settings SHALL 按 DUL-014、DUL-CONSISTENCY-004 只提供 Skills、Pi Packages、AGENTS.md 三个分类。分类导航只选择设置类别，分类内列表只选择当前 Work 的对象，Skill 文件在编辑区的独立文件选择器中切换；不把三层身份混成一棵导航树。选择、键盘焦点与菜单目标分别保存，分类与文件切换保留当前 Work 的未保存编辑，窄屏仍能完成同一路径。

Skills SHALL 以本变更保存的 `prototype/index.html` v5 原型为界面与交互基准：分类导航、可搜索的 Work 对象列表、列表标题旁常驻的可点击“添加 Skill”、选择弹窗、编辑区与独立文件选择器均可操作。Core 候选 SHALL 放在添加弹窗，不以常驻候选区或不可点击标题替代添加入口；手机使用原型同类对象选择器与添加按钮。Work 尚无 Skill 时，编辑区 SHALL 明确给出“添加 Skill”主动作，而不是要求选择不存在的对象。

同一添加弹窗 SHALL 支持勾选启用 Core Skill，以及按 WCFG-EDIT-009 导入本机 Skill 目录；一次确认只提交所选来源的新增目标。Core 目录为空或读取失败 SHALL 不阻断本地目录入口。选择目录后 SHALL 显示名称、文件数与大小并进行已有规则的预检查；取消选择或弹窗不提交，明确点击确认后才添加。成功后关闭弹窗、选中新副本并打开 `SKILL.md`，只保存新增项为 Work 自有、待应用副本；其他本地草稿保留，不一并保存或隐式 Apply。

Skills SHALL 支持读取并编辑 WCFG-EDIT-001—002 允许的既有文本、保存和移除。失败或结果未确认不伪造副本已存在，也不自动重复添加；保留项不从 Core 隐式刷新。目录为空、非空目录全部已添加、列表搜索无匹配与读取失败 SHALL 分别表达；“所有可用 Skill 都已添加”仅用于已确认非空目录且所有候选确已属于此 Work。目录只显示真实数据，缺少说明或版本时省略，不解析全局 Skill 正文补齐元数据。

Settings SHALL 不提供 Advanced、完整配置 JSON 编辑/导入、“使用当前 Core 副本”或“替换为 Core 内容”动作，也不将这些入口搬到其他网页菜单。原完整 CLI/API 配置及显式重选能力保持；New Work 创建表单的 Advanced 不受此更改影响。

Skill 操作菜单 SHALL 显示目标名称与当前 Work 范围，只包含查看详情和从当前 Work 移除。选择配套文件不把移除解释为删除单个文件；菜单动作显式绑定原 Skill，不临时猜测当前全局选中项。菜单支持鼠标、方向键、Home/End、Enter、Tab 和 Esc，退出恢复合法触发点；AGENTS.md 的文件导入直接呈现为按钮。移除先形成未保存更改并提供本次局部撤销，保存并 Apply 后才改变 active，不扩大为文件创建、删除或重命名。

文件已保存、整个 Skill 仍有未保存编辑、Work 已保存设置待应用及 Work 实际运行状态 SHALL 分别依据所属事实表达；草稿未保存和已有配置待应用可以同时可辨。应用状态以 Core 已确认的 `pendingApply` 为准，不以本地 JSON、名称或文本相等覆盖后端捕获事实。运行 loaded/modelVisible 只依据当前已验证 runtime，不由保存、选择或 active 名称推断；stopped、初始化中、失败与观测不可用如实表达。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

piwork-brain SHALL 使用现有 Pi Packages 与 Files 产品流程。Files 中 `.pi/packages/piwork-brain/` 是可编辑源；Settings 中 loaded/modelVisible 对应 active 捕获包，不能因文件已修改就宣称采用。候选详情 SHALL 展示来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态，区分包已加载与实际 SDK 行为已核验。用户显式 Apply 期间仍允许后续配置编辑；晚返回候选不得覆盖无关的新 desired。自动验证只能在有效加载之后运行，不能在 Apply 初始化中调用模型。

候选详情 SHALL 在现有 Package Details 分项展示受理时 active/desired 选择与当前匹配摘要、固定目标及能力、安全输入摘要和必要 checks、准备发布结果、对应 Apply 原 ID/状态，并能按原 ID 打开既有请求/Operation 详情。内部 context identity、制品 digest、凭据和宿主路径 SHALL 不成为展示字段。没有匹配 Apply、观测不可用、加载失败与行为失败 SHALL 分开，不能用 Saved/Loaded 标签或缺字段 JSON 代替这些信息；打开或刷新详情不提交修改，也不重载 Service iframe。

Skills 文件编辑、未提交的移除、已安装包的启停字段与 AGENTS.md SHALL 使用同一份非敏感草稿；“保存全部”的目标不依赖当前分类。显式空内容及空选择保留，按本次明确变更原子更新 desired；未展示字段和制品不被默认值或旧表单覆盖。添加 Skill 及现有 Package 安装/更新/移除的独立提交确认后，界面更新已保存基线并保留其他本地草稿，不将原响应覆盖到更晚编辑。Package 来源、Operation 和既有脏表单保护保持，不将安装演示改为新的本地安装队列。保存失败或结果未确认保留全部编辑，不触发 Apply。

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

Open brain source SHALL 经既有脏配置/文件离开保护后导航到当前 Work 的 Files 并打开明确源文件，成功后关闭原详情且退出 Settings 路由。读取失败 SHALL 在目标上下文显示真实原因与重试，不虚构已经打开；取消离开确认保持原设置与草稿，不丢目标文件身份或擅自保存/Apply。

Settings的Back to Work SHALL 作为左侧内容返回导航，恢复原有效区域/对象，并区别顶栏Back to Works；未保存保护保持。仅在没有未保存编辑、进行中或结果未确认动作，且配置读取已确认、Core 返回 pendingApply=false、没有相关真实故障时 SHALL 使用轻量正常状态及按需详情，不占用大型状态卡或无意义的禁用Apply主动作；Unsaved、Not applied、Applying、失败/未知及安全下一步仍直接可辨。省略正常说明不得合并Save/Apply或把Loaded当成验证完成。

网页不提供镜像或完整 JSON 编辑。Settings 编辑接口只提交本次允许的字段与 Skill 文件，保留 Work 当前 desired 中的 agentImage、modelRef、MCP、工具、资源及其他未提交内容；新建与导入 Work 均适用。非法文本、路径、容量或字段错误就地定位，全部草稿保留，不拆成部分成功写入。结果未确认使用原 Work、原提交涉及字段和文件的一致只读视图检查，不仅比较 Skill 名称；确认只更新已保存基线，后续编辑保留，不自动重发。

#### Scenario: Settings 弹层保留焦点和操作出口
- **WHEN** 用户从已滚动的 Settings 打开 Add Skill，或在窄屏打开 Package Details
- **THEN** Add Skill 在视口居中，Package Details 可全屏展示，两者限制背景交互与键盘焦点，长内容在内部滚动，关闭后恢复可用入口；Skill Details 从菜单切换到单独浮层并返回对象操作按钮

#### Scenario: 添加等待与包来源确认
- **WHEN** 已确认提交 Skill，或用户在安装/更新包时切换来源
- **THEN** Skill 弹窗显示等待并防止误关闭和更换来源直至返回结果，失败或结果未确认只在所属来源显示一次；包操作仅在当前来源输入齐备后可提交

#### Scenario: 原型添加入口在真实页面可操作
- **WHEN** 用户在桌面或手机打开 Skills 分类，包括 Work 尚无独立 Skill 的情况
- **THEN** 列表标题旁与空态提供真正可点击的添加入口，可打开同类选择弹窗；搜索只过滤 Work 对象，不把 Core 候选常驻当作对象列表

#### Scenario: 无 Core Skill 时仍可添加自己的目录
- **WHEN** 普通所有者打开添加弹窗，Core 返回空目录，用户选择本机合法 Skill 目录并确认
- **THEN** 显示真实空目录并保留目录导入入口，成功后选中新副本并打开 SKILL.md，显示已保存待应用，其他草稿不丢失

#### Scenario: Core 勾选沿用原型弹窗
- **WHEN** Core 有尚未添加的 Skill，用户打开添加弹窗并勾选一个或多个候选后确认
- **THEN** 仅所选新增项保存至 Work，候选列表来自真实目录，弹窗关闭并进入新增对象编辑，不自动 Apply

#### Scenario: 空目录与全部已添加不能混淆
- **WHEN** Core 分别为空、非空但全部已添加、读取失败，或 Work 列表搜索无匹配
- **THEN** 分别显示暂无可用 Core Skill、全部已添加、读取失败及重试、无匹配结果；本地导入和已有副本在合法准入下仍可操作

#### Scenario: 上传失败或取消仍保留上下文
- **WHEN** 用户取消目录选择、取消确认，或目录上传被明确拒绝、响应结果未确认
- **THEN** 取消不提交；拒绝定位问题并保留重选入口；结果未确认沿原 Work 和目标提供检查，不自动重传，已有对象与草稿保持

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS 或 Skill 文件内容
- **THEN** 原 Operation 只激活其已接受候选，新编辑仍 Not applied

#### Scenario: 已加载但未完成脑包验证
- **WHEN** 候选 Apply 成功且运行时已加载包，但实际 SDK 目标工具输出尚未通过检查
- **THEN** Package 显示真实加载状态，请求继续显示验证阶段，不显示整个更新已完成

#### Scenario: 候选晚返回与用户新编辑
- **WHEN** 候选准备期间用户保存了无关的 Skills 或 AGENTS 修改
- **THEN** 候选发布保留这些新编辑，冲突的脑包基线单独报告，原 Apply 与后来编辑分别呈现

#### Scenario: 候选详情包含原验收项与 Apply
- **WHEN** 用户打开已准备候选详情，包括无关保存后 Apply 加载失败的候选
- **THEN** 可读到原受理基线、固定能力/输入摘要/必要 checks、准备结果和实际对应的 Apply ID/状态；可按原 ID 查请求与回退依据，Service 页面及当前 Session 不被刷新或替换

#### Scenario: Advanced 修改后从其他页签保存
- **WHEN** 用户在新的 Settings 中跨 Skills、AGENTS.md 编辑，再切到 Pi Packages 保存
- **THEN** 不存在 Advanced 页签，使用共享“保存全部”提交所有明确编辑；原文件及隐藏字段保留，保存只改变 desired

#### Scenario: 添加 Skill 不夹带其他草稿
- **WHEN** 用户编辑 AGENTS 或已有 Skill 文件后，从目录确认添加新 Skill
- **THEN** 新副本确认后显示已保存、待应用并可立即编辑；其他本地编辑继续未保存，添加不保存这些内容、不隐式 Apply

#### Scenario: JSON 非法时尝试转换或保存
- **WHEN** 用户查看 Settings 的输入与导入方式并切换分类保存文本更改
- **THEN** 不提供完整配置 JSON 输入/导入及其解析阻塞；非文本、非法 UTF-8、路径或容量错误在目标文件定位，原字节和全部草稿保留，不冒充保存成功

#### Scenario: 目录失败后恢复
- **WHEN** Skills 或 Packages 曾读取失败，随后用户刷新获得有效目录
- **THEN** 清除对应不可用反馈并恢复合法动作，用户现有选择和草稿保持不变，不覆盖 Core 离线或运行环境未就绪的真实状态

#### Scenario: 目录部分失败及空集合
- **WHEN** Skills 成功而 Packages 失败，随后 Packages 成功返回空数组
- **THEN** 首次只提示 Packages 错误且保留 Skills；后续显示真实空 Packages 目录并清除其错误，保留 Work 已保存副本和未保存选择

#### Scenario: 从脑包详情直接打开源码
- **WHEN** 用户在 Pi Package 详情点击 Open brain source 且文件可读
- **THEN** 进入该 Work Files 的目标 brain.md 编辑器，原详情关闭且路由不再停在 Settings，无需额外找文件

#### Scenario: 脑包导航尊重未保存编辑
- **WHEN** Settings 存在草稿时用户 Open brain source 并取消离开
- **THEN** 仍在原 Settings/详情并保留草稿，没有隐式 Save、Apply 或文件写入；同意离开后才进入目标文件

#### Scenario: 设置正常态简洁而异常仍明确
- **WHEN** 配置分别为一致、未保存、已保存待Apply、Apply中、失败或未知，用户刷新并返回Work
- **THEN** 仅一致状态降为轻提示，其余状态及合法动作明确；返回原区域并执行未保存保护，不自动Save/Apply或丢失后续草稿

#### Scenario: 普通网页编辑保留 Work 自有镜像
- **WHEN** Work 的 desired 镜像与 Core 当前默认镜像不同，用户在网页修改 AGENTS.md 或其他允许的配置并保存
- **THEN** 编辑器不提供镜像修改，提交保留该 Work 已加载 desired 基线的镜像，其他有效字段正常保存且不隐式 Apply

#### Scenario: JSON 导入不能变成镜像修改入口
- **WHEN** 用户打开 Work Settings、Skill 菜单或文件导入入口
- **THEN** 只有三个设置分类及所属动作，没有完整配置 JSON、镜像编辑或 Core Skill 副本替换入口；AGENTS.md 导入和既有 CLI/API 能力保持，网页保存保留原 desired 镜像

#### Scenario: 已保存文件不掩盖其他文件编辑
- **WHEN** 同一 Skill 的 SKILL.md 与已保存内容一致，而一个配套文件有未保存修改
- **THEN** 当前文件可显示已保存，Skill 和全局仍表示有未保存更改，切换文件不会丢失修改

#### Scenario: 未保存与待应用同时存在
- **WHEN** active 为 A、已保存配置为 B，本地又编辑 C
- **THEN** 未保存和待应用同时可辨；保存采用 C，既有 Apply 仅处理自己的已接受内容，不把 B 当作已经运行

#### Scenario: 普通状态与等待不抢占正文
- **WHEN** 设置一致、读取更新、保存或 Apply 正在进行
- **THEN** 一致状态只留轻量文字，普通等待在原控件或固定状态位置呈现；没有重复成功 Alert、正常大卡片或推动编辑区的通用提示

#### Scenario: 已解决的失败与结果未确认分开
- **WHEN** 用户撤回明确失败的未保存修改，或 Core 已确认 pendingApply=false 且 Work 无相关故障；另一操作仍结果未确认
- **THEN** 只退休与当前事实不再相关的已知失败提示，原 Operation 诊断仍可查；未知操作、未确认读取和运行恢复失败不因编辑撤回、配置相同或关闭提示被清除

#### Scenario: 菜单绑定 Skill 而非文件
- **WHEN** 用户选择 code-review 的配套文件并打开 Skill 操作菜单
- **THEN** 菜单明确以 code-review 为目标；移除改变该 Skill 的 Work 选择而非删除配套文件，取消或退出恢复合法焦点

#### Scenario: 普通表单修改后从 Advanced 保存
- **WHEN** 用户在任一现有分类编辑后查找保存动作
- **THEN** 通过共享“保存全部”处理草稿，不存在 Advanced 保存入口或替代 JSON 页面；显式空 AGENTS 和未展示配置保持原契约

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，在原控件、对象状态位或所属任务详情表达动作、目标对象及正在读取/提交/上传/验证的所选界面语言状态；固定图标槽中的等待 SHALL 提供可访问状态说明，适用时可通过提示或按需详情查看文字，仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供适当的 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Work Skill 目录上传/验证与 Core 勾选添加、文件读取/编辑、catalog 检查、AGENTS 文件导入、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、所属任务的 Operation/snapshot 查询、已完成任务提示关闭或本地记录移除 |

收到原 Operation acceptance SHALL 在所属原控件或状态位立即表达对象及 Accepted，并使原 ID 在所属任务详情中可按需查看和复制，不能等待后续 Work、列表、日志或配置读取才表达。收到原 Run acceptance SHALL 在对应消息或 Run 的原上下文立即表达对象与受理状态，原 Run ID 在该 Run 的详情可按需查看，不为显示技术 ID 插入挤压聊天输入区的普通反馈块。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及贴合结构的首读骨架或原控件固定槽三点，并以可访问名称和 busy 语义表达等待，不插入统一检查条或重复的普通 Loading 行。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

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
- **THEN** Core连接区显示正在检查及三点，不能提前显示确定Connected；成功/错误后结束该等待，离线和Runtime未就绪分别说明，检查动作不声称由 Desktop 启动 Core；确认 Core 正在恢复时按实际状态显示启动中

#### Scenario: 通用动作之外的等待不遗漏
- **WHEN** 响应设置自动保存、图片读取、Activity执行、默认Core偏好或About请求尚未确认
- **THEN** 各自原对象显示统一三点及真实阶段，完成/失败后停止；现有内容、iframe、草稿和阅读位置保持，不为此改写业务状态或重复发请求

#### Scenario: Works 首次读取使用稳定骨架
- **WHEN** 目标已确认为 Works、当前身份下的列表尚未确认，初次 Core 检查或 Works 读取正在进行
- **THEN** SHALL 立即显示对应列表结构的骨架及可访问加载状态，可用低对比渐变且减少动态效果时为静态，不呈现空白框或已确认零条；保留所属 Core 检查三点。成功空集合及实际错误后骨架结束，有旧列表刷新时不替换旧正文，减少动态效果下保持可辨

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

#### Scenario: 原动作等待与旁边控件不位移
- **WHEN** 用户提交创建、保存、刷新或操作所属对象，请求被延迟并随后完成
- **THEN** 普通等待只在原按钮或原对象状态位呈现，触发器、邻近按钮、行和导航在前、中、后保持位置与大小；接受、真实结果和可恢复状态不被误报

#### Scenario: 提交与对象阶段各自原位
- **WHEN** 用户提交 Work 或 Service 控制且接受响应及后续状态分别延迟
- **THEN** 先在原触发控件表达提交，再在原对象状态表达已确认阶段；原 Operation ID 和详情可查，未确认状态不冒充成功，等待不新增挤压工作区的状态行
