# piwork 浏览器产品语言

本文规定浏览器界面共享的准确文案与状态原则，以及 `apps/console` Serve 管理面板**如何让用户理解和操作**：术语、信息顺序、按钮位置、文案、状态与恢复。颜色、字阶和控件外观见 [UI 语言](ui-language.md)。CLI Desktop WebUI 沿用共享术语、英文文案和真实状态原则，以 OpenSpec 能力 `desktop-ui-language`（DUL-001 至 DUL-016）统一规定产品、交互与 UI；产品用词见 DUL-003，目标用户和任务场景见 DUL-010。变更期间以该能力的 delta spec 为准，同步后的主规范路径为 `openspec/specs/desktop-ui-language/spec.md`；本文仅提供 Desktop 规范入口，下文的七项管理导航和管理页 section 规则只约束 Serve。终端 CLI 保留自己的交互方式。参考 [GitHub Primer 导航](https://primer.style/product/ui-patterns/navigation/)、[保存](https://primer.style/product/ui-patterns/saving/)与[内容](https://primer.style/product/getting-started/foundations/content/)的清楚范围和明确动作，以及 [Linear 的低噪音表达](https://linear.app/now/behind-the-latest-design-refresh)，具体事实以 piwork 契约为准。

## 术语

| 术语 | 含义与使用规则 |
| --- | --- |
| Core | 同机服务进程，负责能力和稳定 API；不要把面板称为 Core。 |
| Work | 用户的工作单元；“已有 Work”与“后续新 Work”必须区分。 |
| 运行时 | Core 全局运行配置；保存配置不自动等于运行就绪。 |
| 默认 Work | 后续新 Work 的基线；不暗示会修改已有 Work。 |
| Skill | 可上传的完整目录，与 Package 分开称呼。 |
| Package | Core 包库资源，可从 npm、Git、本机目录或 ZIP 安装。 |
| Operation | 可按 ID 查询的持久任务；接受请求不代表任务完成。 |

技术标识 `Core`、`Work`、`Skill`、`Package`、`Operation`、`AGENTS.md`、API Key 及错误码保留原拼写。导航名称与路径固定如下；后续界面沿用这组英文术语：

| 路径 | 导航名称 | 页面对象 |
| --- | --- | --- |
| `/` | Status | Core 状态 |
| `/users` | Users | 账号与角色 |
| `/runtime` | Runtime | 全局运行配置 |
| `/default-work` | Default Work | 后续新 Work 的默认值 |
| `/skills` | Skills | Core Skill 目录 |
| `/packages` | Packages | Core Package 包库 |
| `/operations` | Find Operation | 按 ID 找回任务结果 |

## 界面语言硬约束

在明确提出其他语言要求之前，浏览器 UI **只使用英文**。范围包括标题、导航、表格列、字段标签、选项、按钮、帮助、空态、加载、错误、成功、未知结果、危险确认、浏览器标题和无障碍名称。新增 UI 也遵循此规则。此中文文档和中文 OpenSpec 不是界面文案；它们可以用中文解释规则。

账号、Skill／Package 名称、用户上传的文件名、`AGENTS.md` 正文、用户输入的来源，以及 Core 返回的技术 ID 和原始配置均按原文显示，不翻译、不改写。原始 Operation JSON 可以在展开的技术详情中保留；摘要和行动提示仍用英文。服务端自然语言错误若不是英文，不能直接作为 UI 说明。对已知错误码给出核实过的英文解释和下一步；未知错误给出中性英文说明，例如 “The request failed. Check the current state and try again.”，同时保留安全的 `code`、`field` 与 `correlationId` 供核对。不要从未知消息臆测原因或完成状态。

## 容器职责与内容归属

内容按容器角色归属，不能因为路由或加载状态变化而另起一套顺序。视觉宽度、换行与滚动见 [UI 语言](ui-language.md#容器层级与局部溢出)。所有管理页及详情沿用同一页面轨道；状态切换只更新所属容器中的事实和动作，不改变一级 section 的边界。以下表格同时作为新页面选用容器的目录。

| 容器角色 | 对象、事实与操作 | 状态、错误与恢复 |
| --- | --- | --- |
| 顶栏、导航 | 显示产品入口、当前路由与当前管理员；导航用固定英文名称，不承载某个表单的提交结果 | 会话失效回到登录；局部请求失败不替换整条导航 |
| 页面标题与范围说明 | 标题点明管理对象，邻近的一句话说明作用范围，例如 `Only future Work is affected.` | 页面级连接失败保留标题和可执行的重试或返回入口，不把未知状态写成当前事实 |
| 一级 section | 一个 section 对应一个管理目的，例如当前配置、用户列表或安装 Package；标题、摘要和该目的的动作同属本区 | 加载、空、失败、警告和结果未知留在本区；刷新靠近其更新的 section，错误不另建一个宽度不同的卡片 |
| 摘要与说明 | 先给可判断的当前状态、影响范围和必要时间，再给次级 ID、来源或详情；说明只补充无法从标题判断的限制 | 旧值标明取得时间和历史性质；未知事实明确说未知并给重新读取入口 |
| 表单、字段组与提交区 | 字段标签说明输入对象，帮助说明限制；字段组保持同一配置目的，表单末尾只有一个主要提交动作 | 字段错误贴近对应控件并给修正方式；整区读取或提交错误留在 section；草稿、提交中、成功和结果未知分别表述，未知结果先读回 |
| 选择、排序、列表及表格行 | 每行保留完整对象名称、当前状态、顺序和该对象操作；复制、排序、启用、禁用或移除只作用于本行 | 空集合在列表区说明并给创建或选择入口；不可用引用保留名称和原因，行操作失败保留该行对象及刷新入口 |
| 详情与技术披露 | 详情先有对象摘要及主要动作；原始配置、来源、JSON、错误码和长 ID 在其后可读取或复制 | 详情读取失败保留对象和返回／重试入口；诊断标识放在主说明之后，不用原始消息代替英文解释 |
| 反馈、上传进度与 Operation | 反馈贴近触发动作；上传进度属于上传表单，Operation ID、状态、阶段和查询属于该 Operation | 区分选取、传输、Core 接受、后台处理和终态；观察中断保留 ID、最后已知时间及同一 ID 的恢复入口 |
| 确认 | 当前浏览器原生确认框只写明确的目标、动作和实际后果，例如禁用账号会撤销其会话 | 取消不发送变更；原生确认框的外观由浏览器决定，不把它当作可由页面样式控制的卡片 |

后续若新增对话框、浮层或侧栏，先在对应变更中声明其对象与作用范围、依附的页面或 section、动作和错误归属、关闭及恢复方式，再按 UI 语言声明宽度、焦点返回和窄屏规则。新容器不得让操作脱离对象，或把页面级、字段级和 section 级状态混为一处。

| 采用的英文界面表达 | 避免 |
| --- | --- |
| `Runtime` 标题后说明作用范围；`Current configuration` 内呈现事实，`Edit runtime` 内保留字段和保存结果 | 把保存错误放到无关的新卡片，或让编辑卡片比当前配置卡片窄 |
| `No Skills selected. Choose from the list above.` 留在 Default Skills 选择区，失效项本行显示 `Disabled` 与移除入口 | 只留下空排序标题，或把失效项从列表中静默移除 |
| `Operation ID`、当前 phase 和 `Retry with the same ID` 留在同一 Operation 详情上下文 | 观察中断后隐藏 ID，并在页面顶端只显示 `Something went wrong` |
| `Reset alice's password? This revokes all sessions for the account.` 写明确认目标和后果 | 原生确认框只显示 `Are you sure?` |

## 页面信息顺序

Content 固定遵循五段顺序；没有内容的段可以省略，不能填无信息占位：

1. **对象与范围**：页标题说清对象；标题旁一句话说作用边界，例如只影响后续新 Work。不要重复面包屑或产品介绍。
2. **当前事实**：已确认的状态、时间、来源与重要 ID 在前。读取失败时标为未知；旧值必须带时间并明确为历史记录。
3. **可修改内容**：只放当前对象的字段、帮助与限制。帮助解释不能从标签推断的事实，不重复标签或按钮。
4. **操作**：主动作置于表单末尾；刷新、复制、返回与危险操作贴近所操作对象。动作名称用英文动词和对象。
5. **结果与恢复**：反馈贴近触发处，先写已确认事实，再写下一步；异步任务提供 ID 和可返回的查询入口。原始配置、错误码及 JSON 放在摘要之后作为可选技术详情。

## 按钮位置与主次

- 每个独立表单或 section 最多一个视觉主要动作。保存、创建、上传、安装放在该表单末尾；多字段默认 Work 只有一个保存入口。
- 刷新放在它更新的 section 标题附近；复制贴近 ID；返回贴近详情标题。行操作与对应行对象相邻。
- 返回、取消、刷新、复制是次要动作。禁用、移除、重置密码有危险语义和针对目标的确认，确认写明会撤销会话等实际后果。
- 窄屏按钮可以换行，但仍留在对象或表单附近；禁用状态与原校验、草稿及网络规则一致。

## 字段、按钮与帮助文案

字段标签用对象名，例如 “Model ID”“Operation ID”“Select local directory”；按钮用动词加对象，例如 “Save runtime”“Find Operation”“Upload Skill”。避免只有 “OK”“Submit”“Action” 的按钮。帮助文字只写作用范围、关键限制和下一步，不重复标签。使用简短陈述，不用营销语气或无法证实的保证。

## 长内容、选择与排序

- **长名称与技术标识**：对象名称、来源或 ID 要和对应状态、动作出现在同一区域。允许在视觉上换行；若行宽限制必须省略，仍须在该行提供完整可读取或可复制的原文，不能只依赖截断文本或悬停提示。原文保留大小写、标点和语言，不为适配布局改写。操作按钮的目标始终是本行对象。例：长 Skill 名称完整换行，旁边仍能看到 `Disabled`；避免只显示 `my-very-long-…` 且无法复制全文。
- **空选择**：区分“当前没有选中项”和“可选目录尚未加载”。Default Skills 无选择时写明 `No Skills selected. Choose from the list above.`；不单独留下 `Selected Skill order` 标题和空白区。清空选择只是尚未保存的草稿，只有保存成功后才称为默认值已清空。
- **不可用引用**：默认配置中已选、但已禁用或从目录移除的 Skill/Package，仍在原选择位置显示完整名称和原因，例如 `Disabled` 或 `Removed from catalog`，并给出取消选择的入口。不要静默删去，也不要把失效项计为可用项。服务端拒绝保存时，字段附近说明需要移除或修复失效选择，保留其他草稿。
- **重复行操作**：可见排序按钮保持 `Move up`、`Move down` 这样的短标签；每个按钮的无障碍名称同时包含动作方向与完整对象名称，例如 `Move up Skill my-long-name`。按钮放在相应行内，边界项禁用不能动作的方向。避免把完整长名称重复塞进两个可见按钮，造成换行后无法辨认目标。

## 草稿、提交与错误层级

一个设置区应让管理员从内容判断当前处于哪个阶段：无更改时说明无需保存并禁用保存；本地编辑后标明未保存草稿；提交时禁用重复提交并显示正在保存；收到已确认结果后说明实际持久化值及影响范围；收到明确失败时保留非敏感草稿并给修正或重试入口；请求中断且结果未知时先重新读取当前配置，再由管理员决定是否提交。不得把浏览器选取本地 `AGENTS.md`、上传完成或 Core 接受请求写成最终保存或安装成功。密码和 API Key 按既有安全规则清空，不作为可保留草稿。

错误按作用范围呈现：字段校验错误紧邻字段，指出具体限制和修正方式；读取失败或整区提交失败放在所属 section 内，说明当前事实是否未知及可执行的下一步；页面级连接失败保留页面对象和返回或重试入口。主说明只使用已核实的英文文案。安全的 `code`、`field`、`correlationId` 位于单独的辅助诊断位置，可以选择、复制，不能和主说明拼成一条难以扫描的句子。服务端自然语言消息不能取代主说明，即使它看起来是英文。

| 场景 | 管理员应看到 | 避免 |
| --- | --- | --- |
| Default Work 没有改动 | 当前值；`No changes to save.`；禁用的 `Save defaults` | 只给无法解释的灰色按钮 |
| 编辑 `AGENTS.md` 后尚未提交 | 当前已保存值与未保存草稿分开；保存入口仍在表单末尾 | 选文件后显示 `Saved` |
| 模型字段无效 | `Model ID` 附近指出限制和修正动作；提交区保留整次请求的状态 | 在页尾孤立显示 `Invalid request` |
| 运行时保存请求断线 | `Save result is uncertain. Read the current runtime before retrying.`；保留非敏感草稿 | 自动重复提交或直接写 `Saved` |
| Default Skills 失效引用 | 对应名称、顺序、`Disabled` 或 `Removed from catalog`、取消选择入口 | 不提示原因就删掉该项 |

## 异步阶段与中断恢复

异步流程逐段说清对象、已确认状态、可做动作和下一步：本地文件选取只改变草稿；浏览器传输结束只说明文件已发送；Core 接受请求后给 Operation ID；运行中显示当前 phase 和最近读取时间；终态按 Core 响应确认成功、失败或被取代。观察中断时，ID 和最后一次已确认状态仍可见，并标为历史值；提供使用同一 ID 的查询入口。只有原流程具有稳定幂等键且用户显式选择时才可重放提交。错误详情放在主要状态之后，不能遮挡 ID 或恢复入口。

## 状态、反馈与恢复

反馈遵循“已确认事实 → 影响 → 下一步”：

| 情况 | 表述模式 | 避免 |
| --- | --- | --- |
| 加载 | “Loading users…” | 空白或先显示旧数据 |
| 空 | “No users yet. Create one below.” | 只有 “No data” |
| 读取失败 | “Users could not be loaded. Retry.” 并保留错误详情 | 把历史值写成当前值 |
| 写入结果未知 | “Save result is uncertain. Read the current runtime.” | 显示 “Saved” |
| 成功但未就绪 | “Configuration saved. Runtime is not ready: …” | 只写 “Saved” |
| 上传完成 | “Files sent. Core is validating and publishing…” | “Installation complete” |
| 接受任务 | “Request accepted. Open the Operation for the final result.” | “Installed” |
| Operation 进行中 | “Status: … · Phase: …” 并保留 ID 与查询入口 | 用通用成功提示代替阶段 |
| 观察中断 | “Observation interrupted. Retry with the same ID.” | 暗示任务已取消 |

终态依据 Core 响应写成功、失败或被取代。历史状态标注取得时间。错误码、字段及 correlationId 放在辅助详情中，不取代可操作的说明。若服务未返回足够事实，明确“结果待核实”。

## 七个现有页面的正反例

| 页面 | 采用 | 避免 |
| --- | --- | --- |
| 状态 | 先写可达性、健康、就绪及 checks；刷新靠近标题；不就绪给配置入口 | 把健康写成就绪；断线时沿用旧状态不标时间 |
| 用户 | 列表与创建表单分区；行末对应账号操作；确认写明撤销会话 | 把普通用户引向管理员面板；操作按钮远离账号 |
| 运行时 | 当前配置摘要在前；表单末尾保存；说明每次需完整 Key、已有 Work 不变 | 保存后无条件显示“就绪” |
| 默认 Work | 当前公开配置、字段组、AGENTS.md 本地文件选择与编辑在前；末尾统一保存 | 暗示选文件立即保存或影响已有 Work |
| 默认 Skills | 已选项按顺序显示完整名称、状态和短排序动作；无选择给选择入口，失效引用给原因 | 只有空排序标题，或在两个长按钮中重复 Skill 名称 |
| Skills | 紧凑分隔行；上传说明“选本机目录 → 上传 → Core 验证 → 发布结果” | 把每项套卡片；把上传进度当发布成功 |
| Packages | 列表与安装/更新分区；四类来源互斥；注明 Core 包库与已有 Work 范围 | 把 Core 接受请求写成安装完成 |
| 操作查询 | 详情先写 ID、状态、阶段，复制贴近 ID；技术 JSON 在后；断线可按同一 ID 重试 | 隐藏 ID 或把观察中断当任务失败 |

## 各页英文状态文案示例

以下是模式示例；实现时必须按实际 Core 响应区分已知与未知。详情页沿用其所属对象的用语，登录页与七条导航路由都需覆盖正常、空、加载、错误及适用的异步阶段。

| 页面 | 加载／空 | 错误／未知与下一步 | 异步结果或已确认事实 |
| --- | --- | --- | --- |
| Login | “Checking Core availability…” / “Administrator setup is required.” | “Core is unavailable. Retry the connection.” | “Sign in” 仅在会话建立后进入状态页。 |
| Status | “Checking Core…” / “Runtime is not configured.” | “Current Core status is unknown. Refresh status.” | “Core is healthy · Runtime is not ready” 分开表述。 |
| Users | “Loading users…” / “No users yet. Create one below.” | “Users could not be loaded. Retry.” | “User created. Sign in through piwork-cli.” 或说明管理员面板入口。 |
| Runtime | “Loading runtime…” / “Runtime is not configured.” | “Save result is uncertain. Read the current runtime.” | “Configuration saved. Runtime is not ready: …” |
| Default Work | “Loading defaults…” / “Set up the runtime first.” | “Current defaults are unknown. Retry.” | “Defaults saved. Only future Work is affected.” |
| Skills | “Loading Skills…” / “No Skills yet. Upload a local directory.” | “Upload result is uncertain. Check the current Skill.” | “Files sent. Core is validating and publishing…” |
| Packages | “Loading Packages…” / “No Core Packages yet. Install one below.” | “Acceptance is uncertain. Resume with the same request.” | “Request accepted. Open the Operation for the final result.” |
| Find Operation | “Reading Operation…” / “Enter an Operation ID.” | “Observation stopped. Retry with the same ID.” | “Operation succeeded. Check the Package.” |

## 后续 UI 变更检查

1. 标题、说明、当前事实、设置、结果和恢复入口是否按顺序呈现？
2. 每个独立表单是否只有一个主要动作，且刷新、复制、返回、行操作靠近对应对象？
3. Core、Work、Skill、Package、Operation 与影响范围是否准确？按钮是否指明动词和对象？
4. 加载、空、错误、未知、成功是否区分？上传、接受、进行中、终态是否区分？
5. 危险确认是否写明目标和后果？历史状态是否标时间？详情是否能返回或重试？
6. 是否同时按 [UI 语言](ui-language.md)核对颜色、密度、可访问性和窄屏？
7. 标题、选项、提示、确认、页面标题与无障碍名称是否只用英文？非英文是否仅来自用户原文或展开的技术原文？服务端非英文错误是否经过英文映射或中性兜底？
8. 登录、七条路由与详情是否都按五段 Content 顺序组织？没有事实时是否省去空洞占位？
9. 长名称、来源和 ID 是否在对象旁可完整读取或复制？空选择与目录未加载是否分开？不可用引用是否保留原因与处理入口？
10. 重复排序按钮的可见标签是否简短、无障碍名称是否包含完整目标？窄屏换行后还能辨认操作对象吗？
11. 无更改、草稿、提交中、明确失败、确认成功、结果未知是否各有正确文字与动作？字段错误和整区错误是否处在各自范围内？
12. 异步流程是否保留 ID、最近已确认状态和时间，并在中断后提供同一 ID 的恢复入口？诊断标识是否处于主说明之后？
13. 顶栏、页面标题与说明、一级 section、摘要、表单、字段组、选择与排序行、列表／表格行、详情、技术披露、反馈／进度、Operation 和确认是否各承载自己的对象、事实、动作、错误与恢复入口？
14. 加载、空、失败、提交中或结果未知时，内容是否仍留在原对象和 section 中，没有让一级容器改变宽度或把反馈移到无关位置？
15. 若引入对话框、浮层或侧栏，是否先定义内容归属、关闭与恢复，以及 UI 语言要求的宽度、焦点和窄屏规则？原生确认框是否只约束目标与后果文案？

无法沿用某条规则时，在对应 OpenSpec 变更中写明“产品语言例外”、偏离的规则、理由和替代方案；其余规则继续适用。
