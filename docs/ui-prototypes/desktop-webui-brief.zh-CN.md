# Desktop WebUI：业务需求与原型设计任务书

## 0. 给原型设计者的任务

请依据本文完成 piwork Desktop WebUI 的产品、UX、UI 与可交互高保真原型。整体采用 ChatGPT 式的安静、内容优先、对话自然的语言，并兼顾真实应用与文件操作。请直接完成信息架构、控件摆放、英文文案、状态设计和响应式设计；不要留下需要产品负责人再次决定的基础布局问题。

本文是供 ChatGPT Work 独立使用的设计输入，覆盖当前产品范围，不创建新的后端功能。原型使用模拟数据，模拟流程必须标识为原型。正式规则仍以仓库 OpenSpec 为准；本文不是另一个需要长期同步的规范源。若交付代码，业务数据与动作必须隔离在适配层，方便接入现有 Go CLI 后端。

**完成标准：用户能创建一个 Work，与 AI 对话生成工具，使用其 Service，操作共享文件，调整能力配置，并停止、导出和再次导入该 Work。所有已有基础能力都能找到入口，异常结果也能处理。**

## 1. 产品定位、用户和价值

### 1.1 产品是什么

Desktop 是由本机 `piwork-cli desktop` 启动、在浏览器中打开的 Work 使用界面。它不是原生桌面客户端；“Desktop”表示使用场景和本地入口。

一个 Work 是独立的 AI 工作单元，包含 Agent 对话、运行的 Service、共享 workspace 文件和能力配置。用户可以让 AI 创建并维护工具，也可以亲自进入工具操作数据，再让 AI 通过真实文件或 API 分析这些数据。

### 1.2 目标用户

首要用户是 Work 所有者：以完成任务和使用工具为目的，不要求理解 Docker、反向代理、WebDAV 协议或容器部署。具有技术能力的用户仍能查看域名、ID、端口、日志和完整配置，但技术信息不应占据普通任务的第一视线。

管理员配置 Core 的用户、全局模型和能力库，使用独立 Serve UI。即使当前 Desktop 登录的是管理员，也只能按照自己的 Work 归属使用这里的内容，不能浏览其他人的 Work。

### 1.3 四个主要场景

1. 建立工具：创建 Work → 对 AI 说明需求 → Agent 部署 Service → 打开并使用应用。
2. 持续协作：在应用中操作 → 对 AI 明确提出分析请求 → AI 读取实际可达的文件/API → 返回带来源的结论。
3. 文件工作：上传资料 → 浏览/编辑 workspace 文件 → 与 AI 对话处理 → 下载结果。
4. 保存与迁移：显式停止 Work → 准备完整 `.work` 包 → 下载 → 本地检查包 → 导入为停止状态 → 按需启动。

这些场景决定界面结构。不要围绕服务器资源监控、聊天社交或多项目管理设计产品。

## 2. 对象和产品语言

| 对象 | 固定含义 | 用户应理解的区别 |
| --- | --- | --- |
| Core | 提供账号、Work 和运行能力的服务 | 能连接不代表运行环境已就绪 |
| Work | AI 工作单元 | Open Work 进入界面；Start Work 启动运行 |
| Session | 某个 Work 内的一段对话 | 切换对话不停止执行 |
| Run | 一次消息提交引起的 Agent 执行 | Cancel run 只针对该次执行 |
| Service | Work 中运行的网络应用 | 停止单个 Service 与停止整个 Work 不同 |
| Workspace files | 当前 Work 的共享持久文件 | 根对应 `/var/data/workspace`；不是 Core 宿主目录 |
| Operation | 生命周期、配置应用、安装和迁移等异步操作 | Accepted 不等于完成 |
| Pi Package | 提供 Agent 能力的包 | 不等于用于迁移整个 Work 的 `.work` 文件 |

UI 自有文字、按钮、帮助和无障碍名称统一使用英文；文档用中文，用户内容保留原文。不得将 Work 改称 Project、Session 改称 Task。主要反馈先说对象、结果和下一步，技术 ID 放在可展开详情中。

示例：`Changes saved. Apply changes to use them.`、`Work stopped. Your workspace data is preserved.`、`Connection interrupted. Check the original Operation.`。不使用教学口号、营销标题或只有错误码的提示。

## 3. 已确定的信息架构和视觉权重

### 3.1 两层结构

- 第一层是独立 `Works` 列表，包含搜索、New Work、Import Work、当前账号、连接状态及已知操作的恢复入口。
- 第二层是一个 Work 专属面板。一个面板只展示这个 Work；侧边不常驻其他 Work，也不增加必须经过的 Work 总览。
- Work 顶部始终有 Back to Works、名称、真实状态、状态相关动作和 More。完整 Work ID 与网络标识放入 Work information。
- Work 内有 `Services / Files / Chat` 同级入口和明确的 `Settings`。各入口共享当前 Work，不创建另一套导航上下文。

### 3.2 打开 Work 的默认行为

| 条件 | 默认画面 | 主次关系 |
| --- | --- | --- |
| 运行中且存在可访问 Service | 恢复上次有效的 Service，否则选择就绪的默认 Web 入口 | 应用视口约 66–72%；Agent 辅助栏约 28–34% |
| 运行中，没有可访问 Service，Agent 可用 | 当前/最近可用 Session 对话 | Chat 为主区域，Service 空态解释原因和下一步 |
| Work 停止 | 停止状态与 Start Work、Settings、Export 入口 | 不展示可交互的虚假应用或可读取文件 |
| 部分能力失败 | 保留仍可用的区域 | 局部说明失败，不能把整个 Work 笼统判成不可用 |

`Focus chat` 将同一份对话放大为主区域，返回恢复 Service 选择和当前 Session。文件可以占主区域并保留 Agent 辅助栏。不能同时出现两份同一 Session 的输入框。

### 3.3 视线路径

1. 顶部识别“当前是哪个 Work，能不能用”。
2. 中央看到真实应用、文件内容或对话结果。
3. 在邻近位置找到当前任务动作。
4. 需要 AI 时使用右侧对话。
5. 发生问题时在所属对象附近看到原因与恢复入口。

Work 标识栏保持低干扰；Service 工具栏次于应用本身；Agent 输入区始终可找到。禁止用大状态卡、大域名卡和重复边框挤压内容。

## 4. 完整业务功能清单

以下编号用于验收与原型覆盖表。每一项必须有可找到的入口及返回路径。

| 编号 | 模块 | 必须保留的功能与语义 |
| --- | --- | --- |
| D-F01 | 连接和身份 | 展示当前 Core、账号、角色；登录、退出、切换 Core；检查连接；分别显示可达、运行环境就绪和局部能力可用性；登录过期恢复；启动票据失效/本地入口关闭的恢复说明 |
| D-F02 | Work 列表 | 搜索自己的 Work；明确加载/空/失败；打开 Work；名称、真实状态、一个状态快捷动作与 More 跨行对齐；Work 公共信息、完整 ID 与网络标识可复制 |
| D-F03 | New Work | 默认只要求名称，继承 Core 默认值；Advanced 覆盖基础镜像、Skills、Pi Packages、AGENTS.md 内容/文件及完整配置 JSON；区分 Use defaults / Choose / None；提交前明确合并结果；字段错误保留输入；接受后跟踪原 Work/Operation |
| D-F04 | Work 生命周期 | Start、Stop、Retry、Delete；区分 desired 目标与 observed 状态；Stop 确认影响当前 Run、全部 Service 和文件连接；Delete 确认默认保留持久数据且无 UI 撤销；启动失败的已创建 Work 应重试原 Work，不再次创建 |
| D-F05 | Session | 列表、新建、读取、切换；标题使用实际首消息摘要或创建时间/ID；无 Session 的有效创建入口；旧上下文不兼容给 New session，不自动迁移 |
| D-F06 | Run | 提交消息、流式回复、工具事件、Run 详情、显式 Cancel run；accepted/running/cancelling/succeeded/failed/cancelled/interrupted；一个 Work 仅一个活跃 Run，其他 Session busy 时保留草稿；断线按原 Run/游标恢复，不重发消息 |
| D-F07 | Service 访问 | 选择 Service 和声明的 Web 端口；真实内嵌应用；Focus chat；Open in new tab/独立窗口；Copy domain 与 Copy local link 分开；不配置浏览器代理；嵌入被拒绝时打开原应用标签页 |
| D-F08 | Service 管理 | Manage services 含就绪、禁用、失败、没有 Web 入口的服务；详情含名称、域名、公开端口、enabled、observed、最近错误与 Operation；Start/Stop/Restart/Retry/Remove；有界日志快照、Refresh、取得时间与截断说明 |
| D-F09 | Workspace 浏览 | 当前路径、目录导航、文件名/类型/大小/修改时间等已知元数据；打开、下载、刷新；空目录、读取失败、特殊文件、停止/能力缺失状态分开 |
| D-F10 | Workspace 写入 | 上传逐文件结果、新建目录、同 Work 重命名/移动/复制/删除；文本编辑、Save file、Discard；目的地选择、覆盖确认、目录递归删除影响；207 部分成功逐路径说明；未知结果先重读 |
| D-F11 | 外部 WebDAV | 可选辅助入口 Connect with WebDAV：独立启动 `piwork-cli proxy`、完整 Work ID 的 `/works/<workId>/files/` 地址、实际用户名/端口来源、临时密码到启动终端获取；浏览器 Files 不需要此步骤 |
| D-F12 | Work Skills | 查看 Core 可用目录及真实详情；查看 Work 现有选择与 active/runtime 状态；选择、清空、保存；区分沿用 Work 副本与重新选择 Core 副本；不可用目录不抹除 Work 已保存选择 |
| D-F13 | Work Pi Packages | Core 可安装目录、Work 已安装列表和详情；安装来源 Core/npm/Git/本地目录/ZIP；更新时显式新来源或当前 Core 副本；enable/disable/remove；选择与清空并保存；显示 desired/active/pending/loaded 等真实状态 |
| D-F14 | AGENTS / Advanced | AGENTS.md 当前与待应用内容、文件导入、编辑、保存/放弃；完整配置 JSON 查看、导入、编辑、保存；包含有效的镜像、modelRef、MCP、资源与工具策略等公开字段；不呈现平台 secret |
| D-F15 | Apply changes | 保存只修改 desired；独立 Apply Operation；In use / Saved changes / Not applied / Loaded / Visible to model 分开；Run busy 不取消 Run；失败/回退失败/被取代/未知可诊断；停止的 Work Apply 后仍停止 |
| D-F16 | Import / Inspect | 选择本地 `.work`，无需登录即可完整本地检查和查看安全摘要；可仅检查后退出；登录后审核名称并上传导入；留空名称让 Core 命名，显式冲突贴字段；导入成功是 stopped，Open 与 Start 分开 |
| D-F17 | Export / Download | 先显式 Stop 并确认完全停止，再 Prepare .work package，再校验并 Download；保留 Operation/snapshot ID；原 snapshot 下载恢复、过期、空间不足；下载开始不等于落盘完成 |
| D-F18 | 操作恢复 | Work/Service/Apply/Package/Import/Export 的 Operation 详情和按 ID 查询；按需展示本地已知记录，允许清除记录；原 snapshot ID 查询入口；记录按 Core/用户隔离，不成为全局任务历史，不保存内容或密钥 |

### 4.1 Work 状态与动作规则

- Ready：Open Work；快捷 Stop Work。
- Degraded：展示具体受影响能力；可用内容继续使用；提供详情和 Stop。
- Stopped 且已确认完全停止：Open Work 进入控制信息；快捷 Start；允许 Settings 与 Export。
- Starting/Stopping：当前阶段、原 Operation 与 Check status；不得预告终态。
- Failed 且 desired=running：Retry Work；保留原错误与历史 Operation。
- Stop failed 且 desired=stopped：检查原 Stop Operation，不用 Retry Work 改回运行目标。
- 状态未知：最后确认时间、Check status，不写 Ready/Stopped，不显示伪造的零数量。

### 4.2 Service 的必须理解的边界

- Service 创建和定义更新由 Agent 工作流完成；没有手工 Service 创建/部署表单。
- Stop Service 是持久禁用，后续启动 Work 不恢复该已禁用服务；停止整个 Work 保留其他 Service 的 enabled 状态，启动后恢复它们。
- Start Service 不自动启动停止的 Work。Restart/Retry 根据 enabled 和实际运行状态准入。
- Remove Service 不删除共享 workspace 文件；不能通过 Start 撤销 Remove。
- `.work` 域名是 Core 服务身份，例如 `counter.w-a1b2c3d4.work`。浏览器入口是本机 CLI 提供的 URL；两个复制动作必须有不同文案。
- Copy local link 仅供本机使用，要求 Desktop CLI 持续运行及有效登录，不描述为公网分享。
- 浏览器支持声明的 HTTP/ws 入口、SSE、WebSocket、应用路径和自身会话；不承诺任意 TCP/UDP、HTTPS/wss 上游或自动改写应用正文。
- 应用的 CSP、登录和样式保留；禁止为了内嵌预览取消安全策略或替换应用 UI。

### 4.3 AI 和文件的数据边界

选择 Service 仅提供身份上下文，不自动分享页面 DOM、未保存表单、浏览器 Cookie、localStorage 或截图。Composer 中用简洁的可选 `Include Service identity` 标明这一点。

用户明确提问后，Agent 才通过实际可读的 workspace 文件或 Service API 获取数据。原型示例必须标明读取来源，不用“页面已同步给 AI”的文案。

Files 只对应这个 Work 的 workspace。Service 只有声明挂载共享 workspace 后才与 Agent 共享其中的持久数据；不是所有容器内部文件都出现在 Files 中。Work 停止时 Files 读写均不可用；不展示 Core 目录。

文本编辑限额为 **1 MiB UTF-8**，超过限额或二进制提供下载替代。特殊项不作为普通文件编辑；workspace 根不可删除、移动或改名。同 Work 并发写入忙碌应局部提示，不承诺锁、自动合并、跨 Work 移动或目录 ZIP 下载。

## 5. 核心 UX 流程

### A. 初次使用并生成工具

启动地址 → 校验本地票据 → 沿用有效 CLI 登录或 Sign in → Works 空态 → New Work → 输入名称 → Create Work → 准备状态/Operation → Ready → 打开 Chat → New session → 提交创建应用需求 → Run 文本与工具进度 → Service 就绪 → 进入真实应用。

新 Work 没有 Service 时，以聊天为主；Service 出现后提供清晰的 Open service 动作，不突然丢弃当前输入。工具调用默认折叠成名称与执行状态，可展开查看真实内容；不能把长 `toolResult` 或 Skill 全文占满主对话，也不能伪造不存在的工具结果字段。

Composer 使用 Enter 发送、Shift+Enter 换行；输入法组合输入期间 Enter 不发送。空白输入不提交；提交中/Run busy 时保留草稿并解释原因。流式回复期间，只有用户仍位于末尾才跟随滚动；用户向上阅读时提供回到底部入口。Send message 与 Cancel run 是不同语义，取消中不立即恢复成可再次执行的空闲状态。

### B. 使用 Service 与 AI 协作

打开 Work → 应用主区域 + 同 Session 的 Agent 辅助栏 → 应用中保存数据 → 用户要求读取文件/API 分析 → 明确来源的回复 → 需要长文时 Focus chat → 返回原 Service。独立 Service 窗口保持 Work 身份及 Back to Work；关闭它不停止应用。

### C. 修改文件

Files → 打开目录 → 上传/新建文件夹 → 打开文本 → 修改 → Save file → 真实保存结果。离开脏编辑器时提供 **Save file / Discard / Keep editing**；保存失败保持草稿。覆盖明确目标；目录删除明确递归范围；部分成功列出成功和失败路径。网络中断后先 Refresh 核对，不自动重复写入。

### D. 修改 Work 能力

Settings → 当前能力与保存草稿 → 选择/安装/导入/编辑 → Save changes → Not applied → 独立 Apply changes → Operation 终态 → Refresh configuration status → 确认 active 与 loaded/modelVisible。

编辑期间突出 Save；无未保存草稿、存在待应用配置时突出 Apply。安装成功不等于模型已加载。Apply 接受之后再保存的新内容继续显示待应用。失败时展示原 active 保留情况；回退失败应说明 Work 故障。

### E. 完整迁移

Work 菜单 Export → 运行时解释必须先 Stop，提供显式 Stop 入口 → 停止确认及 Stop Operation → 完全停止 → 用户再次发起 Prepare package → Export Operation 与 snapshot ID → 校验完成 → Download .work。

Works → Import Work → 本地检查 → 安全摘要及私有数据提醒 → 可选名称 → 登录/上传/Import Operation → 成功的 stopped Work → **Open Work** 与 **Start Work** 两个分开的动作。

不能把导出合并成自动 Stop，不在导入完成时自动运行包内代码。`.work` 是完整 Work 包，包含格式定义的共享数据等持久内容；普通文件下载不替代 Export。

## 6. 容器和控件职责

| 容器 | 放什么 | 返回/关闭规则 |
| --- | --- | --- |
| Works 页面 | 自己的 Work、搜索和首要入口 | 行打开与行按钮不互相误触 |
| Work 身份栏 | 名称、状态、当前状态动作、More | Back to Works 不停止 Work |
| Service 工具栏 | 服务/端口、状态、域名、Open in new tab、复制和管理 | 应用内部工具栏留在应用视口 |
| Agent 栏 | 当前 Session、消息、工具反馈、输入、Run 状态 | Focus 与收起不复制会话或取消 Run |
| Files 主区域 | 路径、列表、选中项、编辑器和传输结果 | 路径在文件区域内导航，不丢 Work 上下文 |
| Settings | Skills/Pi Packages/AGENTS.md/Advanced、Save 与 Apply | Back to Work 先处理未保存编辑 |
| 对象详情抽屉/主区域 | Service、Run、Operation、日志和技术身份 | Close 只停止观察，返回来源并还原焦点 |
| 对话框 | 创建、目的地、覆盖、删除等单任务 | 明确对象、影响、主要动作、Cancel；普通关闭不取消已接受 Operation |
| 按需活动区 | 本次 Desktop 已知的操作与恢复 | 不占永久导航，不冒充服务端历史列表 |

一个当前任务最多一个高强调动作。危险动作放 More/详情，并在确认界面写出名称和实际影响。导航、复制链接、读取、关闭详情不要求危险确认。

Service 工具栏把服务/端口选择放左侧，状态和域名处于同一低强调信息组，Open in new tab 放右侧；复制和管理收纳在清楚命名的次级菜单中，不能把五六个等权按钮排成一整条。文件列表使用选中项/行菜单承载目标动作；工具栏的 Upload/New folder 属于当前目录，不与某个文件的 Rename/Delete 混用。Settings 的全局 Apply 状态不出现在单个文件编辑器中。

## 7. 视觉与响应式的直接设计约束

### 7.1 风格

采用 ChatGPT 式自然对话、柔和输入区、克制导航、清楚阅读宽度与低噪音工具反馈。不要照搬 ChatGPT 的账号套餐、GPT 商店、全局聊天列表或附件能力。保留 piwork 的 Service 与文件协作布局。

首版定为浅色。使用以下统一语义令牌，后续整体改样式通过令牌和共享组件生效，不逐页改色。Service 应用内部样式不受外壳主题控制。

| 角色 | 值 |
| --- | --- |
| 画布 / 次级背景 / 主表面 | `#F5F8FC` / `#F8FBFF` / `#FFFFFF` |
| 分隔 / 控件边框 | `#DCE7F2` / `#BAC9D8` |
| 正文 / 次级文字 | `#1B2634` / `#526477` |
| 强调 / 柔和选中背景 | `#0969DA` / `#EAF3FF` |
| 危险 / 警告 | `#B42332` / `#8A5A00` |

系统无衬线，正文 14–16px，标题 24–30px，辅助 12–13px；路径/域名/代码等宽。间距用 4px 基数，小圆角、细分隔；默认无装饰阴影、无渐变/毛玻璃/巨大欢迎标题。Agent 回复以连续正文为主，用户消息可用柔和浅底；代码与工具详情局部滚动。

### 7.2 几何和对齐

- Works 为居中、宽度受控的列表页面；名称摘要、状态、当前动作、More 各自固定列角色，跨行对齐。不要使用不对称卡片矩阵。
- Work 面板充分使用窗口空间，身份栏约 64–72px；分栏可调整但保留可读宽度，不将 Service 压成小预览卡。
- 聚焦 Chat 的正文宽度约 720–800px，输入与阅读区域对齐；Agent 辅助栏不强行复用宽屏全文尺寸。
- Work 内各区域使用一致层级，不叠卡片套卡片；控件等高、图标与文字垂直居中、相邻按钮间距一致。
- 1440px 展示完整分栏；1024px 若无法维持可用应用宽度，则 Agent 改为可收起/覆盖栏；768px 以下使用 Services/Files/Chat 单主区域切换。360px 不强塞双栏。
- 设置与日志在窄屏单列；表格/代码只在自身区域滚动，整页不横向溢出。弹层不超出视口，长文件名和域名仍能看全或复制。

### 7.3 可达性

键盘可完成所有基础流程；焦点至少 2px 可见轮廓。模态获得并限制焦点，关闭回到来源；普通非提交中的弹层 Escape 关闭，危险确认 Escape 取消。图标有英文可访问名称，触屏热区至少约 40px。状态同时有文字，对比度正文至少 4.5:1；遵守 reduced motion。生成流式回复不得持续抢夺滚动或焦点。

## 8. 必须设计的状态与恢复

| 情况 | 原型必须呈现 |
| --- | --- |
| Core 不可达 | 保留最后确认身份/时间，Check connection；不当作密码错误 |
| 认证过期/撤销 | 停止授权内容访问，返回登录恢复，不重提原 mutation |
| Desktop CLI 关闭 | 本机入口不可用；指导重新启动并打开新启动地址，不承诺纯前端能在关闭后继续工作 |
| 退出时 Core 不可达 | 本地访问立即结束，明确远端撤销未确认；不说成功撤销全部会话 |
| 正在提交 | 防重复，反馈留在表单；没有真实进度时显示阶段，不伪造百分比 |
| Operation 观察中断 | 原 ID、最后已知状态/时间与 Check status；关闭不取消 |
| 请求结果未知但没有 Operation ID | 保留草稿并核对目标状态，不自动再次提交 |
| Service 拒绝内嵌 | 保留身份/状态，Open application tab，不移除 CSP |
| Work/Service 停止 | 不可用原因和返回；已渲染应用不保证能被外壳实时覆盖 |
| Run busy / 旧 Session 不可续聊 | 保留草稿，定位活跃 Run / New session，不伪造队列 |
| Files 单项失败/部分失败 | 具体路径与原因；不笼统显示全部成功 |
| 配置保存未 Apply | Saved changes / In use / Not applied；独立 Apply |
| 包上传与安装 | Uploading / Validating / Accepted / Preparing / 终态分开；目录不保留执行位和链接，必要时建议 ZIP |
| 导出锁冲突/空间不足/快照过期 | 原对象和恢复方向；不自动 Stop/再 Export |
| 浏览器发起下载 | 只显示 Download started，不能证明文件已落盘 |

## 9. 原型画面与模拟数据要求

请制作可独立查看、可点击串联的画面/状态；以下是覆盖项，不要求为每个状态新增一个永久页面。默认打开完整正常场景，并提供仅在原型中可见的 Scenario switcher 测试异常。设计评审画板分模块摆放，不能把所有小截图密集塞进一张图。

| 画面编号 | 画面/状态组 |
| --- | --- |
| D01–D04 | 有效登录 Works；Sign in/Core 选择；Core 不可达/认证过期；Works 空态 |
| D05–D08 | 混合状态 Work 列表；New Work 简单/Advanced；创建接受/准备/失败；Work 信息/生命周期确认/Operation |
| D09–D12 | 有 Service 的完整协作区；无 Service 的 Chat 主区；Stopped/Degraded Work；Chat focus 与返回 |
| D13–D16 | Session 选择/新建；Run 流式文本与工具折叠；busy/cancelling/失败/恢复；Run 详情 |
| D17–D20 | Service/端口切换与复制；独立应用窗口；拒绝内嵌/不可用；Manage services、详情、控制和日志 |
| D21–D24 | Files 浏览/空目录；文本编辑及脏稿处理；上传/目录/移动复制/覆盖删除；部分失败/特殊文件/WebDAV 辅助说明 |
| D25–D28 | Settings Skills；Pi Packages 列表/详情/五类安装与更新来源；AGENTS.md/Advanced；Save/Apply 各阶段和失败 |
| D29–D32 | 本地 Inspect 摘要/无登录；Import 表单与冲突；Import Operation；成功 stopped 与 Open/Start |
| D33–D36 | 运行时 Export 准入；Stopped Prepare package；导出/校验/下载状态；原 Operation/snapshot 找回和失败恢复 |

模拟数据至少包括：

- `Notes`（Ready，有两个可预览服务）、`Counter`（Stopped）、一个启动失败且 desired=running 的 Work、一个仅部分 Service 失败的 Degraded Work。
- Service `counter`、`notes`、一个禁用服务、一个失败服务、一个没有 Web 端口的服务；真实形式的域名和不同 Work 网络标识。
- 示例 counter 在用户访问后增加计数，并将持久结果示意为 `/data/counter/count.txt`，与 Agent 回复明确引用该文件相对应；标注这是模拟。
- 长中文 Work 名、长 Service 域名、长文件名、UTF-8 文本、二进制、大文本、目录和特殊项。
- 两个 Session、一个活跃 Run、一个工具结果较长的 Run、已保存但未应用配置、loaded 与 modelVisible 不同的 Skill。
- 无 description/version 的能力元数据必须显示未提供，不能补出评分、作者头像或推荐标签。

## 10. 原型交付物与接入约定

1. 可交互高保真原型：上述所有流程可点击，不能只有截图；原型状态与真实数据逻辑分开。
2. 页面/状态地图：每个 D-F 编号对应入口、画面、动作、成功状态、失败状态和返回。
3. 产品文案清单：英文导航、按钮、状态、危险确认、空态和恢复文案，不留 lorem ipsum。
4. 设计令牌和组件状态：WorkRow、WorkHeader、ServiceToolbar、AgentPanel、Composer、ToolEvent、FileBrowser、TextEditor、Settings、OperationDetails、TransferProgress、Dialog、Feedback 等；包含 loading/disabled/error/focus。
5. 1440px、1024px、768px、360px 代表性画面与长内容/放大检查；桌面 Chrome/Edge 是首版运行验收范围。
6. 若提供可接入前端源码：业务接口集中在 adapter，模拟状态在 fixtures；不要在组件中散布假 URL、模拟 token 或后端启动代码。不要求更换当前前端技术栈。
7. 保留 Go CLI 本地身份/API、Service 独立 origin、文件/WebDAV、Run 事件和 Operation 恢复能力的接入位置。凭据不进入 localStorage；不使用外部在线编辑器 iframe 代替文件编辑。
8. 交付覆盖报告：D-F01–D-F18 与 D01–D36 全部可定位。现有 UI 不够美观的 prompt/confirm/原始 JSON 展示可重新设计，但底层动作和真实语义不得丢失。

## 11. 本次不设计的能力

不增加 Work 重命名、Work 终端、全局 Operation 历史、用户手工 Service 部署编辑器、任意 TCP/UDP 访问、公网分享、跨 Work 文件操作、目录 ZIP 下载、系统 WebDAV 挂载/文件锁兼容、自动读取浏览器页面、用户管理、模型账单/用量图表、多租户组织或协作权限。

不把 bootstrap、Docker 安装、证书配置、浏览器代理配置纳入普通 Work 使用流程。外部 WebDAV 只作为已有能力的辅助说明。

## 12. 交付验收

- 基础功能没有被 ChatGPT 风格简化掉；Service、Files、Chat 都能完成实际任务。
- 一个 Work 一个面板，没有强制总览或其他 Work 常驻侧栏。
- Service 和 Chat 权重符合场景，文件操作与设置有明确归属，不堆在首页。
- Work、Service、Run 的 Stop/Cancel/Remove 含义正确；状态与可执行动作一致。
- Save 与 Apply、Inspect 与 Import、Stop 与 Export、Open 与 Start 均分开。
- 结果未知、断线、脏稿、部分成功、过期和权限失败有具体恢复动作。
- 状态和按钮跨行对齐；短/长名称、无数据和窄屏均能正常使用。
- UI 自有文案英文，无虚构能力、假数据指标或永久技术警告。
- 全部主题样式可通过语义令牌与共享组件一致调整，应用视口保持独立。

### 仓库依据（接入人员使用，原型设计者无需另行查阅）

- `openspec/specs/desktop-ui-language/spec.md`：DUL-001–016。
- `openspec/specs/desktop-webui/spec.md`：DWUI-001–010。
- `openspec/specs/browser-service-access/spec.md`、`work-file-access/spec.md`、`work-configuration/spec.md`、`agent-conversation/spec.md`。
- `docs/desktop-webui.md`；`apps/desktop-webui/src/app.ts`、`files.ts`；`internal/cli/user_desktop*.go`。
