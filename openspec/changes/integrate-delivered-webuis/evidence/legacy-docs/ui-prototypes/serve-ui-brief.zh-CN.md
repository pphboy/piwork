# Serve UI：业务需求与原型设计任务书

## 0. 给原型设计者的任务

请依据本文完成 piwork Serve UI 的产品、UX、UI 与可交互高保真原型。视觉目标是 **Linear 的低噪音、紧凑秩序 + GitHub Settings 的清楚分区、明确表单与危险操作**。请直接完成布局、信息层级、控件、英文文案、状态和响应式，做到整洁、专业、可实际管理；不要添加漂亮但没有数据或业务依据的仪表盘。

本文供 ChatGPT Work 独立制作原型，覆盖当前业务范围。使用可控模拟数据与状态，不新增后端功能。正式规则仍以仓库 OpenSpec 为准；本文是设计输入，不替代规范。若提供源码，数据和动作隔离在适配层，方便接入现有 Go Console 后端。

**完成标准：管理员能判断 Core 是否可用，管理用户，配置模型运行时与新 Work 默认值，维护 Core 的 Skills 和 Pi Packages，并按 ID 找回已接受的包操作。**

## 1. 产品定位、目标用户与责任边界

Serve UI 是 `piwork-console serve` 提供的独立 HTTPS 管理面板，与 Core 同机部署，通过 loopback API 管理 Core。浏览器可以在另一台设备打开它。面板关闭或重启不会停止 Core，也不会取消 Core 已接受的后台任务。

目标用户是部署和维护该 Core 的管理员，能够理解模型 provider、镜像、API Key、Skill 与 Package，但仍应得到明确的字段说明、影响范围和恢复入口。

Serve 管理的是**平台条件与能力来源**；Desktop 管理的是**某个用户自己的 Work 使用过程**。本面板没有 Work 列表、用户对话、Service 预览、workspace 文件、WebDAV 或 `.work` 导入导出入口。管理员也不通过这个面板阅读用户 Work 内容。

典型任务：

1. 完成 Core 部署后检查状态并配置运行时。
2. 为使用者建立账号，必要时禁用、重新启用或重置密码。
3. 维护可供新 Work 使用的 Skills、Pi Packages 和默认配置。
4. 安装/更新能力包，并在网络中断、换设备或面板重启后继续查询原任务。

## 2. 产品语言和术语

| 名称 | 固定含义 | 不能混淆的对象 |
| --- | --- | --- |
| Core status | Core 连接、进程健康与运行就绪状态 | Healthy 不等于 Ready |
| Users | 该 Core 的账号和角色 | 不包含组织/团队/权限矩阵 |
| Runtime | 全局 Agent 镜像、模型和凭据 | 不代表已有 Work 的运行配置已切换 |
| Default Work | 后续新建 Work 的默认配置 | 不会 Apply 到已有 Work |
| Skills | Core 可供选择的 Skill 库 | 更新/删除 Core 条目不删除已有 Work 副本 |
| Packages / Pi Package | Core 的 Agent 能力包库 | 不等于 `.work` 迁移包，也不表示某 Work 已 loaded |
| Operation | Core 包安装/更新的持久异步操作 | 上传完成、接受与最终发布分开 |

UI 自有文字和无障碍名称用英文，资源名、用户内容、ID 和错误码保持原文。说明以管理员当前任务为主，不写宣传口号。

示例：`Runtime saved. Core is not ready yet.`、`Defaults saved. Only future Work is affected.`、`Remove this Skill from Default Work first.`、`Observation interrupted. Resume using this Operation ID.`。

## 3. 已确定的信息架构

### 3.1 页面和导航

维持七个管理模块的稳定顺序：

1. `Status` — `/`
2. `Users` — `/users`
3. `Runtime` — `/runtime`
4. `Default Work` — `/default-work`
5. `Skills` — `/skills`
6. `Packages` — `/packages`
7. `Find Operation` — `/operations`

保留 Skill、Package、Operation 的独立详情 URL，以及 `/login`。Find Operation 是输入 ID 查询的入口，不是操作历史。

**本次采用紧凑顶栏导航**：品牌/当前 Core 标识、上述模块、管理员账号与 Sign out。不为模仿 Linear 增加占据左侧的大导航架构；页面整体仍遵守现有统一管理轨道。360px 导航换行或通过可展开的菜单到达所有模块。

### 3.2 页面阅读顺序

页面标题与一句任务说明 → 当前对象/配置摘要 → 可执行的管理任务 → 邻近的结果反馈 → 按需展开的技术详情。

- Status 优先回答“能不能用，哪里需要处理”。
- 列表优先名称、状态、主要元数据、动作；长 ID 下沉详情但必须可读取/复制。
- 设置优先当前配置与影响范围，然后编辑字段和保存。
- 安装/上传优先来源、所选内容摘要、提交和阶段，不先展示长技术日志。
- 危险动作留在行 More/详情底部的明确区域，不与主要保存按钮并排争夺注意力。

## 4. 完整业务功能清单

以下编号用于原型覆盖与接入验收，每项必须有入口、目标、结果与恢复。

| 编号 | 模块 | 必须覆盖的能力 |
| --- | --- | --- |
| S-F01 | 登录/会话 | 管理员账号密码登录；错误、禁用/不存在统一认证失败；普通用户访问拒绝并指向用户 CLI/Desktop；未 bootstrap 说明通过 CLI/env 初始化；限流等待；过期/撤销/权限失效；Core 不可达；Sign out 与失败重试 |
| S-F02 | Status | 当前管理员、Core 可达、进程 health、readiness 状态/原因、公开 checks、最后检查时间；Refresh；可见页面定期更新；运行时未配置有 Runtime 入口；旧状态必须标明取得时间 |
| S-F03 | Users 浏览/创建 | enabled 与 disabled 全部账号；account、ID、role、enabled、创建/更新时间；Refresh；创建 account/password/confirmation/role；默认普通 User；成功清空密码；普通用户和管理员成功后的使用入口说明不同 |
| S-F04 | Users 控制 | Enable/Disable、Reset password 与确认；禁用/重置撤销该账号全部会话；启用不恢复旧会话；最后一名启用管理员保护；自身禁用/重置成功回登录；不存在/并发变化可刷新 |
| S-F05 | Runtime 查看 | Agent image、model provider、model ID、可选 Base URL、credential 是否可用、更新时间；空配置与已有配置分开；不返回/回填 API Key |
| S-F06 | Runtime 保存 | 非敏感字段预填；每次保存重新输入完整 API Key；可选 Base URL 留空使用默认；校验、saving、saved、saved but not ready、明确失败、未知结果 readback；仅影响后续新 Work |
| S-F07 | Default Work | 当前公开完整配置；编辑基础 Agent 镜像、Skills、Packages、AGENTS.md；其他公开字段只读；没有默认配置时引导 Runtime，不猜配置；仅保存实际编辑字段，保留并发无关变更；无改动禁用保存 |
| S-F08 | 默认能力选择 | enabled Skills/Packages 多选；Skill 顺序可上移/下移；明确 None/清空；保留失效引用及原因；Default Packages 最多 64；默认选择变更不安装、不启用、不删除 catalog 条目 |
| S-F09 | 默认 AGENTS.md | 查看/编辑/导入本地 UTF-8 文件；导入只填草稿；替换脏稿确认；最多 256 KiB，以 UTF-8 字节计；读取错误/取消保留旧稿；空文本明确清空 |
| S-F10 | Skills 浏览/详情 | enabled/disabled 全部条目按名称排序；名称、默认引用、公开 source/更新时间/文件信息等真实元数据；详情和 Refresh；空、加载、失败、对象消失状态；不编造 description 或 loaded |
| S-F11 | Skills 上传 | 浏览器选择完整目录添加或更新；根必须有 SKILL.md；目录 basename 为 Skill 身份，更新须与目标同名；内容摘要、限制、上传进度、Core 校验和成功；取消/中断/未知结果核对条目 |
| S-F12 | Skills 控制 | Enable/Disable/Remove；移除确认名称和影响未来可选能力；已存在 Work 副本保持；默认引用保护给 Default Work 入口，不自动修改默认集合 |
| S-F13 | Packages 浏览/详情 | Core enabled/disabled 包，名称、版本或未声明、sourceKind、enabled、isDefault、资源数量；安全 resolvedSource 与详情；Refresh；不展示 Work loaded/pendingApply |
| S-F14 | Packages 安装/更新 | npm、Git、本地目录、本地 ZIP 四种来源；安装可勾选 Add to Default Work after installation，默认关闭且成功时原子加入；更新目标名称不可改、必须显式来源、保留 enabled/默认引用；源切换清理不适用输入 |
| S-F15 | Packages Operation | 上传 → 验证/传送 → 接受 → 后台阶段 → 终态；稳定幂等意图；得到 Operation ID 后独立详情和轮询；中断恢复；接受响应丢失可 Resume this submission，同源同键重放；失败后显式新意图重试 |
| S-F16 | Packages 控制 | Enable/Disable/Remove；默认引用保护；busy 说明任务仍进行；动作同步确认不虚构 Operation；已有 Work 副本不受影响 |
| S-F17 | Find Operation | 按 ID 查询 Core package Operation，任一有效管理员可查询已知 Core scope ID；显示状态/阶段/时间/包名/结果/安全诊断；进行中恢复观察；终态停止轮询；不存在与 Work scope 一样不可用 |

## 5. 各页面的直接设计要求

### 5.1 Login

统一画布上的居中窄列，内层最大 420px：`Administrator sign in`、Core 可用性、Account、Password、Sign in。首次未初始化时说明用 CLI/env bootstrap，不出现创建首个管理员表单。

失败保留账号、清空密码。普通用户有效凭据明确“Only administrators can access this console.”并给使用方向；不展示平台内容。限流显示真实剩余等待时间。Core 网络失败单独显示，可重试连接，不误报密码错误。

### 5.2 Status

使用紧凑状态摘要和检查行，不做巨型 KPI 卡。首先区分 `Core reachable`、`Process health` 和 `Runtime readiness`。不就绪显示真实原因，如 Runtime not configured / Runtime unavailable / Recovering，并给已有模块的有效入口。

Readiness 不是一条保存消息。最后检查时间和 Refresh 与当前状态相邻；连接断开后标记旧结果，不能继续用绿色 Ready 冒充当前状态。可见页面每 15 秒刷新，重新聚焦检查会话。

### 5.3 Users

主列表是可扫描的表格：Account、Role、Status、Created、Updated、Actions；完整 User ID 可在展开详情中呈现/复制。所有行使用一致状态列和操作列，不因长名称错位。默认主动作 `Create user` 打开完整创建表单，Refresh 为次级。

创建字段：Account、Password、Confirm password、Role（默认 User，可选 Administrator）。账号为 1–128 字符，首字符字母/数字，后续允许字母、数字、`.`、`_`、`:`、`-`；密码 12–1024 字符。重复账号不覆盖已有用户。

Disable 与 Reset password 确认必须写账号和“全部会话撤销”。最后管理员保护说明至少保留一名启用管理员；确认框不能在没有 Core 结果时提前改行状态。Reset 表单完成后清空密码；自身账号失效跳登录，其他用户操作不登出当前管理员。

### 5.4 Runtime

上部 Current configuration 只展示公开字段及 Credential available/unavailable；下部 Edit runtime。字段依次：Agent image、Model provider、Model ID、Custom Base URL、API Key。每次保存重新输入 Key，读取不到旧值。

`Save runtime` 附近说明仅影响未来新 Work。保存后使用 Core 确认的配置回填非敏感字段、清空 Key，并分别显示“已保存”和“是否 ready”。Docker/镜像不可用时已保存配置仍保留，提供 Refresh status，不自动重复保存。

保存结果未知保留非敏感草稿，提供 Read current runtime 比对；不缓存 Key、不宣称成功或失败。API Key 仅在提交时传递，不在原型示例中使用真实值。

### 5.5 Default Work

Current defaults 摘要 → Edit defaults；用 section/分隔组织 Agent image、Skills、Packages、AGENTS.md；完整公开 JSON 收纳在只读技术披露。这里没有 Work 层面的 Apply changes。

Skill 选择后显示有序行和 Move up/Move down/Remove；长名称可完整读取，当前禁用/移除引用保留并贴原因。空选择明确 `No Skills selected`。Packages 多选/清空，上限 64。不可用项不静默从草稿消失。

AGENTS.md 可文件导入或直接编辑，有 UTF-8 字节计数。导入不自动保存；覆盖脏稿确认；超过 256 KiB、解码失败或取消保持原文。

`Save defaults` 只提交改动字段，整体成功/失败；无修改禁用。表单邻近说明“Defaults affect only future Work”。结果未知时先读回比对，禁止直接重发全部配置覆盖他人无关编辑。

### 5.6 Skills

列表 → 独立详情；主动作 Add Skill。详情先名称、Enabled/Disabled、Default/Not default 与公开元数据，再 Update directory 和状态控制，低频 Remove 为危险入口。

上传来源是浏览器所在设备的目录。不是填写 Core 宿主路径。目录名为身份，规则 `[a-z0-9][a-z0-9-]{0,63}`；根 SKILL.md 必须存在，不从 frontmatter 改名。更新同名目录。先展示目录名、文件数、总大小，再 Upload。

上限：2,048 普通文件、8 MiB 单文件、32 MiB 总内容；不能上传符号链接/特殊文件。浏览器不支持目录选择时禁用并解释，不能降级成服务器路径表单。

阶段是 Uploading（已发送字节）→ Validating → Core confirmed。取消选择保留原选择；未知结果先查询当前 Skill，不能把重复 Add 自动变 Update。禁用/移除默认引用时给 Default Work 入口，不替用户取消引用。

### 5.7 Packages

列表 → 独立详情；Install Package 表单用互斥来源选择：npm / Git / Local directory / ZIP。切换已选择文件的来源前提示丢弃，避免提交旧输入。

npm/Git 输入实际 spec；本地来源使用文件/目录选择器和内容摘要。身份由 package.json.name 决定，不能取 ZIP 文件名当包名。目录根必须有 package.json；ZIP 由 Core 验证单一合法根。不能把 `.work` 当 Pi Package。

安装表单默认不勾 `Add to Default Work after installation`；勾选则安装与默认引用原子成功/失败。更新展示不可变目标名称，显式新来源，不出现该安装选项，不暗改 enabled/默认引用。

上传限制：ZIP 256 MiB，展开内容 1 GiB，单文件 64 MiB，100,000 条目、64 层、manifest 1 MiB；前端检查已知部分，完整校验由 Core 做。浏览器目录只传普通文件，不保留执行权限和符号链接，需要这些信息时建议 ZIP。

安装提交后取得 Operation ID，进入详情 URL。只有真实上传字节有百分比，安装/准备只显示实际阶段，不编造总体 73% 等进度。Update 名称不一致、默认引用保护、busy 都应贴合目标且保留正确状态。

### 5.8 Find Operation / Operation details

Find Operation 是 ID 输入框与查询动作。详情展示可复制 ID、包名（已知时）、state、packagePhase、时间、result 和安全 stage/code/message；原始脚本日志不作为公开面板内容。技术字段可展开，主要状态和下一步在前。

非终态串行约每 2 秒查询；终态停止。失败/被取代允许返回表单，以新意图显式重试。没有取消包任务按钮。

面板关闭、网络中断、登录到期只停止观察。换设备/重启后凭 ID 找回；任一有效管理员可查已知 Core scope 包 Operation。不要声称自动找回未保存 ID，也不提供历史任务表。

## 6. 必须串联的 UX 流程

### A. 让 Core 满足使用条件

Sign in → Status 显示 Runtime not configured → Runtime 填字段/Key → Save runtime → 分别确认 persisted 与 readiness → 需要时返回 Status 检查 → Ready。

首次缺管理员在登录页显示 CLI/env 初始化方向，不能在此流程创建首个管理员。首次缺 runtime 也不妨碍可用的用户/能力管理页面。

### B. 给使用者建立账号

Users → Create user → 默认普通 User → 字段校验 → Core 确认 → 列表出现新账号 → 明确提示使用用户 CLI/Desktop。管理员账号则说明可登录本面板。

Disable/Reset 的确认有对象与会话影响；Enable 后仍需重新登录。没有账号改名、角色编辑和删除操作。

### C. 设置后续 Work 的能力

Add Skill / Install Package → Core catalog 条目确认 → Default Work 选择能力/顺序及编辑 AGENTS.md → Save defaults → 明确只影响未来 Work。已有 Work 继续使用其副本；不能冒出“全部 Work 已应用”的成功提示。

### D. 包安装中断后恢复

Packages → 选择来源 → Upload/Validate → Accepted → 复制 Operation ID → 后台 Preparing → 网络中断/关闭 → 重新登录或换设备 → Find Operation → 同 ID 继续观察 → 成功条目可见。

若接受响应丢失且当前页仍保存相同来源和幂等键，可点击 `Resume this submission` 取得原 Operation；新键只能用于明确的新意图。不要用普通 Retry 反复重新安装。

### E. 引用保护

Skill/Package 的 Disable/Remove → Core 返回被 Default Work 引用 → 目标状态保持 → Open Default Work → 用户明确移出引用并保存 → 回原详情再次发起动作。不能在确认框偷偷自动取消默认引用。

## 7. 状态、错误与安全的产品表现

| 状态 | 必须设计的行为 |
| --- | --- |
| Loading / empty / read failed | 各自明确；错误不当空列表，失败保留刷新入口 |
| Unsaved / unchanged / saving | 保留非敏感草稿；未改禁用保存；提交中防重复 |
| 字段校验失败 | 错误跟随字段，保留非敏感输入并定位；密码按安全流程清空 |
| Accepted / preparing / published | 分阶段反馈，取得原 Operation ID 后持续沿用 |
| 写入结果未知 | 不展示成功，也不自动重提；读取目标/原 Operation 后再决定 |
| Observe interrupted | 保留最后确认状态、时间和 ID，Resume observation |
| Saved but not ready | 配置保存成功与环境不可用同时表达 |
| Default reference / busy | 不提前改变列表行；给去掉引用或等待原任务的有效路径 |
| Session expired / revoked | 回登录，停止轮询，清空密码/文件引用；不重新提交编辑 |
| Temporary Core failure | 保留尚未到期会话与安全草稿，提示连接失败并允许检查 |
| Sign out 遇到 Core 不可达 | 提示注销未完成，允许重试；不宣称已撤销成功 |
| 长名称 / 无版本 / 对象被移除 | 全名可读/复制；未声明不猜版本；对象不可用有 Back/Refresh |

密码和模型 Key 不放入 URL、页面存储、原型数据、日志或回显摘要。Core bearer 只在 Console 后端；浏览器使用受保护 Cookie。原型不得要求用户粘贴 token。

离开脏表单、刷新覆盖草稿、换来源舍弃文件应提示；普通阅读和导航不滥用危险确认。禁用账号、重置密码、移除资源的确认写具体名称和实际影响，不能只有 `Are you sure?`。

## 8. UI 设计的直接约束

### 8.1 风格与令牌

安静、精确、紧凑的管理工作台。借鉴 Linear 的低噪音边界、扫描效率，GitHub Settings 的 section、表单和危险区。主内容比导航更醒目。不复制它们的项目、Issue、仓库、团队、通知等功能。

首版浅色，以下角色统一使用；样式调整通过令牌与共享组件统一生效。

| 角色 | 值 |
| --- | --- |
| Canvas / Header / Surface | `#F5F8FC` / `#F8FBFF` / `#FFFFFF` |
| Border / Control border | `#DCE7F2` / `#BAC9D8` |
| Text / Muted | `#1B2634` / `#526477` |
| Accent / Accent hover / Selected soft | `#0969DA` / `#0759BA` / `#EAF3FF` |
| Danger / Warning | `#B42332` / `#8A5A00` |

正文 14px、行高 1.5，页面标题 22px、section 16px、辅助 12–13px；系统无衬线，ID/来源/JSON 用等宽。4px 间距基数，常用 8/12/16/20px；小圆角、细边框，默认无阴影。

禁止紫蓝渐变、毛玻璃、深色大顶栏、大指标卡、营销插画、卡片套卡片、无限留白或每个记录一张厚重卡片。状态不能仅靠颜色。

### 8.2 容器与对齐

- 顶栏约 56px；所有已登录页面及详情统一最大 **1100px** 页面轨道。页面标题、说明、一级 section 左右边界跨路由一致。
- 一级 section 白色、1px 细边框、6–8px 圆角，桌面 padding 16–20px、窄屏 12px；列表用行与分隔。
- 管理表单统一 **176px 标签列 + 16px 间距 + 最多 520px 控件列**，内部网格最多 712px。帮助、错误、字段组、计数和提交与控件列对齐。
- 右侧余量保持空白，不填装饰区；表格可使用完整卡片宽度，但只在自身滚动。
- 登录也处于统一外层轨道，其内层最大 420px 居中单列；不把登录窄宽度复用到 Runtime/Default Work。
- 控件至少 34px 高、圆角约 6px，表格目标行高 40–44px；操作按钮与状态跨行同列对齐。
- 摘要可限制内部行宽，原始 JSON/长文本局部换行/滚动；任何内容不能撑宽一级 section 或挡住动作。

### 8.3 主次动作和文本角色

页面标题识别任务，section 标题识别信息组，标签命名输入，辅助文字说明限制，反馈说明结果与下一步。不要用不同字重和随机边框代替这些角色。

每个表单/当前任务只有一个主要动作；Refresh/Back/Cancel 为次级。Primary 亮蓝，危险红色只用于实际危险动作。列表行只给适当快捷动作，其他放 More/详情。登录和普通读取不需要额外确认。

### 8.4 响应式与键盘

1440px 检查统一轨道，1024px 等比例收束；卡片内空间不足时表单统一单列，不逐字段补任意 margin。360px 标签在上，字段、说明、错误和提交左对齐，连续 section 两侧齐平，主要动作不被宽表格遮挡。

只允许表格/JSON/代码局部横向滚动；整页不横向溢出。长 Skill 名和排序按钮互不遮挡，全名可读/复制。主要内容在浏览器放大后仍可用。

控件有英文可访问名称；至少 2px 可见键盘焦点。弹层管理焦点并关闭后返回来源；危险确认 Escape 取消。正文对比度至少 4.5:1，状态配文字，尊重 reduced motion。

## 9. 原型画面和模拟场景清单

原型必须可点击完成完整管理任务。以下是画面/状态组，不是新增路由；可以用组件状态切换呈现。原型评审画板按模块分开，避免所有页面密集混排。

| 编号 | 画面/状态组 |
| --- | --- |
| S01–S03 | Sign in 正常；普通用户/初始化/限流；Core 不可达/会话过期 |
| S04–S06 | Status Ready；缺 runtime/环境不可用/Recovering；旧状态与刷新失败 |
| S07–S09 | Users 列表与创建；禁用/启用确认；密码重置/最后管理员/自身退出 |
| S10–S12 | Runtime 现有/首次配置；编辑/字段错误；保存成功但 not ready/未知后读回 |
| S13–S15 | Default Work 当前与草稿；Skill 顺序/长名称/失效选择/空集合；AGENTS 导入及未保存处理 |
| S16–S18 | Skills 完整列表与详情；目录添加/更新/校验/进度；默认引用保护/移除确认 |
| S19–S21 | Packages 完整列表与详情；四类安装来源/默认选项；更新表单/身份不符/上传异常 |
| S22–S24 | Operation 进行中/终态/失败；观察中断/Resume this submission；Find Operation 有效/无效/Work scope 拒绝 |

模拟数据至少包括：

- 一个启用管理员、一个启用普通用户、一个禁用用户，以及长账号名；场景切换可模拟最后管理员保护。
- 已配置的模型及 `Credential available`，示例 Key 只用明显假值；ready 与 saved/not-ready 分开。
- 两个启用 Skill、一个禁用 Skill、一个默认引用；长名称和失效默认引用。
- 包含 npm/Git/local/ZIP 的 Package 条目，一个未声明 version 的包，一个默认包、一个禁用包。
- 一个安装中 Operation、一个成功、一个失败、一个 superseded，以及连接中断恢复。
- 真实形式的 ID 和可复制长来源；未知/缺失值不填写假的统计或描述。

## 10. 原型交付物与接入约定

1. 可交互高保真原型，覆盖 S-F01–S-F17 和 S01–S24；有独立可控的正常/异常状态，不能仅产出截图。
2. 页面与功能覆盖表：入口、动作、表单字段、成功/失败/未知、返回与恢复一一对应。
3. 英文产品文案集：账号权限、默认引用、运行时影响、上传限制、Operation 阶段和危险确认均完整。
4. 设计令牌与共享组件：ConsoleShell、PageHeader、Section、DataTable、StatusLabel、FormGrid、Field、SelectionList、OrderedSkills、UploadSourcePicker、UploadProgress、OperationDetails、DangerConfirm、Feedback。
5. 1440px、1024px、360px 的代表性画面、长内容与键盘/放大检查；跨路由比较一级容器与表单边界。
6. 若交付源码：API 集中 adapter、fixture 可替换，不在组件内放模拟 token、真实密码或服务启动逻辑；不要求更换前端框架。
7. 保留现有导航路由与详情链接，接入 Console 的会话/CSRF、管理 API、浏览器上传及 Operation 查询。不能改成浏览器直读 Core 私有目录或任意路径代理。
8. 现有实现中的原生 confirm、页面内堆叠表单和原始 JSON 详情可以重排为专业组件，但不能删掉管理动作、字段、错误语义和恢复入口。

## 11. 本次不设计的能力

不增加 Core 启停/重启、Docker 管理、证书管理、首管理员 bootstrap 表单、账号自助注册/改名/删除/修改角色、用户 Work 浏览、Agent 对话、Service 部署或预览、workspace/WebDAV、`.work` 导入导出、全局任务历史、包任务取消、私有源交互登录、组织/RBAC 编辑器、审计日志、计费、模型测试聊天、资源监控图表或多 Core 管理中心。

不因为参考 Linear/GitHub 增加 Issue、看板、仓库、评论、团队或通知。Core 的内存统计不是现有 UI 业务能力，不添加假实时内存图。

## 12. 交付验收

- 七个模块与详情完整，无 Desktop 的用户内容功能混入。
- 状态页能判断 Healthy/Ready/不可达，并正确引导现有配置入口。
- Users 的会话撤销和最后管理员保护正确，没有虚构账号管理动作。
- Runtime Key 不回显，配置保存与 readiness 分开。
- Default Work 仅影响未来 Work，默认选择、顺序、失效引用和部分字段提交表达正确。
- Skills/Packages 从浏览器上传，不填写服务器路径，不把上传完成当安装完成。
- 默认引用保护、busy、响应丢失和观察中断有可完成的恢复流程。
- Operation 可按 ID 找回，没有自动历史或 Cancel 的假入口。
- 表单、表格、状态与按钮对齐；长内容不撑宽，360px 不溢出；英文文案、键盘和焦点完整。
- 原型既有完整正常任务，也有足够异常态；视觉精致但不依赖无业务依据的装饰和指标。

### 仓库依据（接入人员使用，原型设计者无需另行查阅）

- `openspec/specs/serve-ui/spec.md`：SUI-001–004。
- `serve-ui-users/spec.md`：SUI-USR-001–002；`serve-ui-configuration/spec.md`：SUI-CFG-001–004。
- `serve-ui-skills/spec.md`：SUI-SKL-001–003；`serve-ui-packages/spec.md`：SUI-PKG-001–005。
- `docs/product-language.md`、`docs/ui-language.md`、`docs/serve-console.md`。
- `apps/console-webui/src/app.ts`；`internal/cli/console*.go`。
