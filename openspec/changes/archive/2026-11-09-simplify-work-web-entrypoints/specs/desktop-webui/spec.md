# Spec Delta

## MODIFIED Requirements

### Requirement: Work 创建与生命周期使用真实控制结果

**Identifier:** DWUI-003

New Work SHALL 以名称为唯一必填项并继承 Core 已保存的默认配置；Advanced 默认折叠，只提供 Skills/Packages 默认、选择、显式清空及 AGENTS.md 文件/文本。网页 MUST NOT 提供 Base image 或完整配置 JSON 输入，也不显示配置合并摘要与覆盖优先级说明。网页创建请求 SHALL 省略 baseImage 和完整 configuration 覆盖，由 Core 取得默认镜像；其余字段的省略和显式空集合语义保持。校验失败保留输入，接受后显示原 Work/Operation 与准备状态。CLI/API 的现有镜像及完整配置能力不因网页入口变化而改变。

创建重名 SHALL 基于 Core 确认的名称冲突显示在 Name 字段附近，说明该名称已被使用或保留并要求选择其他名称；保留名称和全部高级输入，提供可访问错误关联，避免仅显示通用 CONFLICT 或重复错误条。显示原因不得通过客户端列表推断；其他状态冲突、配额、依赖或网络失败不得被改写为重名。已删除记录或在途导入的现有名称占用仍有效，提示不得承诺删除可见 Work 就能释放名称。

列表和 Work 面板 SHALL 支持 Start、Stop、Retry、Delete、公开身份及详情，遵守 DUL-008。Stop 确认影响当前 Run、Service 和文件连接；Delete 确认默认保留数据、不提供假撤销。仅 desired=running 的失败提供 Retry；停止失败查询原 Stop，不将目标改回运行。accepted、running、succeeded、failed、superseded 和 unknown SHALL 分开；删除后即使 Work 已不在列表，原 Operation 仍可查询。

New Work SHALL 区分未完成的创建草稿与可靠受理后的下一次新建。明确拒绝、未发送或结果未知时保留原输入和对应恢复保护；可靠取得原 Work/Operation 后，下次 New Work 默认使用新名称空值和当前默认配置，不静默继承上次高级覆盖。新建期间不得因旧创建晚结果清空较新的草稿，原已受理对象仍可找回。

Start/Retry 的进度 SHALL 留在所属 Work 上下文并保留原 Operation 详情入口。真实对象及相应能力确认可用后 SHALL 提供直接 Open Work；用户明确选择 Start and open 时才可在完成后衔接打开该 Work。普通 Start 不强制导航，不以 Operation succeeded 代替 Work Ready。

Stop确认的影响范围 SHALL 以明确非交互说明呈现，不能把装饰图标表现为不可勾选的Checkbox，也不得增加原流程没有的确认勾选门槛。真正Delete确认框、Stop/Stop and export的原动作与一次提交保护保持。

#### Scenario: 默认创建和显式空集合
- **WHEN** 用户分别使用默认配置及显式空 Skills/Packages 创建
- **THEN** 前者采用 Core 默认，后者不被默认填回；成功准备前不显示 Ready

#### Scenario: 停止取代启动
- **WHEN** Start 尚未完成时 Stop 已接受且旧 Operation 被取代
- **THEN** 当前目标为 stopped，旧操作显示 superseded，不能继续以旧结果显示 Ready

#### Scenario: 停止失败与删除
- **WHEN** 停止失败，或删除已接受而 Work 已离开列表
- **THEN** 前者不可 Export 且可查询原 Stop；后者保留 Delete 观察入口，不提前宣布清理完成

#### Scenario: 创建重名定位到名称字段
- **WHEN** 普通创建被 Core 以名称已被使用或保留拒绝
- **THEN** Name 字段附近显示可理解的所选界面语言的换名提示，名称及高级草稿保持，没有假 Operation 或自动提交

#### Scenario: 重名提示只依据确认原因
- **WHEN** 创建发生名称冲突，或发生其他 CONFLICT、配额、依赖、连接失败
- **THEN** 仅确认的名称冲突使用重名字段提示；其他错误沿既有反馈处理，不因名称在列表中存在或不存在而猜测原因

#### Scenario: 创建请求返回前修改名称
- **WHEN** 用户提交名称 A 后在响应返回前改为名称 B，随后 Core 返回 A 的名称冲突
- **THEN** 说明原请求使用的 A 被拒绝，保留 B 与高级草稿，不把 B 标为无效，不自动再次创建；名称比较与实际提交一样忽略首尾空白

#### Scenario: 两次创建冲突逆序返回
- **WHEN** 同一创建表单先提交名称 A，再由用户显式提交名称 B，B 的名称冲突先返回，A 的名称冲突随后返回
- **THEN** 保留 B 的当前名称、高级草稿、Name 字段错误及可访问关联；A 的迟到响应不得覆盖或清除 B 的表单错误，旧请求仍按原记录处理，不产生额外创建请求

#### Scenario: 已受理创建后的下一次新建
- **WHEN** 创建 A 可靠受理后用户再次 New Work
- **THEN** 新草稿不带入 A 名称、AGENTS/Skills/Packages 等高级覆盖；A 的 Operation 仍可查，没有第二次隐式创建

#### Scenario: 未知创建保留原草稿
- **WHEN** 创建响应丢失或明确拒绝，用户关闭并回到该创建流程
- **THEN** 原输入保留，未知仍核对原结果而非新建重发；晚到的原接受不会清空其他新草稿

#### Scenario: 从列表启动后可直接进入
- **WHEN** 用户从 Works 显式 Start，原操作和 Work 相继确认成功及可用
- **THEN** 原行或结果处直接提供 Open Work，不必关闭 Operation 再重新定位名称；Start 只提交一次

#### Scenario: 停止范围没有假勾选控件
- **WHEN** 用户打开Stop Work或Stop and export确认
- **THEN** 可读到整个Work、Service、Agent和Files影响，范围说明不伪装可点选项；取消零提交，确认只提交原授权动作一次

#### Scenario: 新的创建表单默认折叠
- **WHEN** 用户打开新的 New Work 表单或刷新后再次进入创建
- **THEN** 高级配置为折叠状态，名称是唯一必填项；页面不出现镜像、完整 JSON、配置合并摘要或手动 Operation ID 查询，提交不携带镜像及完整配置覆盖

#### Scenario: 折叠只改变高级字段展示
- **WHEN** 用户展开 Advanced，修改 Skills、Packages 或 AGENTS.md，再收起并展开
- **THEN** 同一未提交草稿中的有效输入保持，表单不发送请求；用户显式创建时才提交这些选择

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Settings SHALL 按 DUL-014 完整提供 Skills 目录与 Work 选择/清空、AGENTS 当前/待应用内容及导入编辑、Advanced 中除受保护 Agent 镜像之外的公开配置 JSON 编辑/导入、Pi Package 目录及 Work 已安装项。In use、Saved changes、Not applied、runtime loaded/modelVisible SHALL 各自对应真实状态。目录不可编造说明；重选 Core 副本与保留 Work 副本的语义须明确。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

piwork-brain SHALL 使用现有 Pi Packages 与 Files 产品流程。Files 中 `.pi/packages/piwork-brain/` 是可编辑源；Settings 中 loaded/modelVisible 对应 active 捕获包，不能因文件已修改就宣称采用。候选详情 SHALL 展示来源摘要、受理基线、验证目标、准备/发布结果及真实 Apply 状态，区分包已加载与实际 SDK 行为已核验。用户显式 Apply 期间仍允许后续配置编辑；晚返回候选不得覆盖无关的新 desired。自动验证只能在有效加载之后运行，不能在 Apply 初始化中调用模型。

候选详情 SHALL 在现有 Package Details 分项展示受理时 active/desired 选择与当前匹配摘要、固定目标及能力、安全输入摘要和必要 checks、准备发布结果、对应 Apply 原 ID/状态，并能按原 ID 打开既有请求/Operation 详情。内部 context identity、制品 digest、凭据和宿主路径 SHALL 不成为展示字段。没有匹配 Apply、观测不可用、加载失败与行为失败 SHALL 分开，不能用 Saved/Loaded 标签或缺字段 JSON 代替这些信息；打开或刷新详情不提交修改，也不重载 Service iframe。

Skills、Packages、AGENTS.md 与 Advanced SHALL 展示同一份未保存配置；保存结果 SHALL 不取决于当前页签。有效 JSON 中的显式空集合和空 AGENTS 内容 SHALL 保留，未在普通表单编辑的其他公开字段 SHALL 保留；重复编辑同一字段采用最后一次有效显式编辑。非法 JSON SHALL 保留输入并定位错误，阻止配置提交与向其他配置页签转换，用户仍可修正或明确放弃草稿。保存失败或结果未知 SHALL 保留完整非敏感草稿，不触发 Apply。

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

Open brain source SHALL 经既有脏配置/文件离开保护后导航到当前 Work 的 Files 并打开明确源文件，成功后关闭原详情且退出 Settings 路由。读取失败 SHALL 在目标上下文显示真实原因与重试，不虚构已经打开；取消离开确认保持原设置与草稿，不丢目标文件身份或擅自保存/Apply。

Settings的Back to Work SHALL 作为左侧内容返回导航，恢复原有效区域/对象，并区别顶栏Back to Works；未保存保护保持。saved与active一致时 SHALL 使用轻量状态及按需配置详情，不占用大型正常状态卡或无意义的禁用Apply主动作；Unsaved、Not applied、Applying、失败/未知及安全下一步仍直接可辨。省略正常说明不得合并Save/Apply或把Loaded当成验证完成。

网页 Advanced 的可编辑 JSON SHALL 不含 agentImage，不增加替代镜像表单。保存其他字段 SHALL 保留当前已加载 desired 配置基线中的原 agentImage，不能用 Core 默认值或 active 镜像替换；现有 Work 和导入 Work 均适用。导入或编辑 JSON 若显式携带不同于该基线的 agentImage，SHALL 给出所选语言的字段错误并保留待修正输入，不保存或 Apply；相同镜像字段可作为冗余输入处理。其余公开字段、显式空集合、AGENTS 清空与跨页签草稿保持原语义。该限制属于网页编辑入口，不改变 Core、CLI 或直接 API 的配置契约。

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS/Advanced 内容
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
- **WHEN** 用户在 Advanced 修改 Skills、Packages、AGENTS.md 和其他公开字段，切到 Skills 或 AGENTS.md 后保存
- **THEN** 相应页签展示新值，提交包含全部修改，不用原表单值覆盖 JSON；保存仅更新 desired

#### Scenario: 普通表单修改后从 Advanced 保存
- **WHEN** 用户先修改 Skills、Packages 或 AGENTS.md，再打开 Advanced 保存
- **THEN** JSON 展示并提交普通表单的新值，显式空值保留，同一字段最后一次有效编辑生效

#### Scenario: JSON 非法时尝试转换或保存
- **WHEN** Advanced 存在无法解析的 JSON，用户切换配置页签或点击任一保存入口
- **THEN** 保留原文及脏状态，显示定位错误，不转换到另一配置页签、不发配置 PUT；明确 Discard 可放弃该草稿

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
- **WHEN** 用户向 Advanced 输入或导入带有不同 agentImage 的 JSON
- **THEN** 页面定位镜像字段错误并保留输入；不发送配置保存或 Apply，用户可删除该字段后继续编辑其他配置

### Requirement: 已知操作恢复不形成隐式任务队列

**Identifier:** DWUI-010

Desktop SHALL 在 Work、Service、Apply、Packages、Import、Export 所属任务上下文提供原 Operation 详情和基于已知原任务身份的只读恢复；没有可见 Work 的创建、导入及已移除 Work 任务在 Works 列表提供必要的临时提示。账号菜单不提供 Known operations，全局操作列表和操作中心不作为替代入口。已接受操作持久记录仅含 Core/用户归属、类型、相关身份 ID 和时间；页面重载后重新查询原对象，不能称为全局历史。记录不得包含凭证、提示词、文件正文、包字节或来源秘密。未知结果 SHALL 保留最后确认时间、原 ID 和 Check status；无 Operation ID 的未知提交不能自动再发，提示核对对象状态。

多窗口与观察重连 SHALL 不导致重复 mutation。请求进行时防重复点击，关闭普通详情仅结束该详情展示/读取观察，不取消远端执行；已经明确授权且仍有效的导出交付按 DWUI-009/013 继续；有幂等键的提交保持该次键且不用于新意图。读失败采用有界退避，鉴权失败进入恢复，404/410 不无限重试。用户可隐藏已完成提示或清除本地显示记录，不改变 Core 对象、未完成任务的恢复、待同步依据或未知修改保护。

Desktop 网页 SHALL 移除所有手动输入 Operation ID 的查询表单、按钮及相应入口文案，包括 New Work、创建/导入辅助恢复和 Work 任务/历史上下文。已知原任务的 Check status、详情、进度、错误原因及既有失败恢复 SHALL 保留；查询失败时保留最后确认事实及原任务，不以重新创建/重新安装替代查询。移除输入入口 SHALL 不删除底层 Operation 查询能力、持久记录或恢复协调保护，不新增全局任务中心。按 Snapshot ID 找回原快照属于独立流程，不受此次 Operation 输入入口移除影响。

#### Scenario: 删除后重载
- **WHEN** Delete 已接受且列表已无该 Work，用户刷新页面
- **THEN** 从当前身份已知记录恢复原 Operation，仍可查看清理结果

#### Scenario: 提交响应丢失
- **WHEN** 控制请求已发送但未取得 Operation ID
- **THEN** 显示结果未知并引导核对状态，不自动再次提交，不虚构 ID 或失败终态

#### Scenario: 多窗口观察同一任务
- **WHEN** 两个窗口恢复同一个已知 Operation
- **THEN** 二者只查询该任务，无新增 mutation，切换身份后不读取旧身份记录

#### Scenario: 原任务恢复不要求手输 ID
- **WHEN** 用户查看创建、导入、生命周期、Service、Apply 或 Package 的已知进行中/失败任务
- **THEN** 所属上下文不出现 Operation ID 输入框；原任务的状态检查与详情仍绑定原身份，关闭详情不取消任务，查询失败不触发重提
