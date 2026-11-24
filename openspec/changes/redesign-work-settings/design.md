# Design

## Context

动机与产品范围见 [proposal.md](proposal.md)。本设计同时涉及 Desktop、HTTP DTO、Core 授权与 Work-owned context，因此需要独立设计产物。

规格落点：[Work 配置](specs/work-configuration/spec.md)、[Skill 发现边界](specs/skill-management/spec.md)、[Desktop 行为](specs/desktop-webui/spec.md)与[UI 语言](specs/desktop-ui-language/spec.md)。

初轮规划时调查所得的实现背景（以下旧行号不作为修订后验收依据）：

- `apps/desktop-webui/src/app.ts` 的 Settings 渲染及 `4380–4480` 附近动作以四页签、共享 `Configuration` 和 Core 副本刷新组织；`configuration.ts` 通过 `advanced` JSON 保存完整对象。`adapter.ts:2906` 发送完整配置 PUT，`replaceSkill` 则发专用 skills PUT；当前没有 Work Skill 文件内容读写。
- `internal/coreapp/skill_read.go` 的公开目录只返回名称。Core 不解析 `SKILL.md` 生成说明/版本；原型中的说明是合成数据，不能照搬到真实列表。
- `work_configuration_save.go` 的完整 PUT 在名称数组变化时重选整个 Core Skill 集；`workcontext/packages.go` 只在“全部重选”与“原名称数组原样保留”之间切换，`skill_material.go` 的 prior 读取还要求名称及顺序完整一致。因此不能把新编辑简单叠到现有 reselect 分支。
- `workcontext/default.go` 发布完整、不可变 context；`coreapp/package_context.go` 负责包来源保留；`work_configuration_save.go` 的提交循环已包含授权复核、提交顺序竞争和失败 candidate 清理。Skill 文件运行时属于只读 context，不在普通 workspace Files 的可写范围。
- `internal/corestore/repository.go:138` 的 `pendingApply` 按内部 revision/context 关系计算。原型的对象/文本相等判断不足以代表这一事实，不能为消除 UI 提示而新增内容去重或改写现有 Apply 语义。
- `internal/workaccess/policy.go` 区分 Metadata/Control 与 Content；非所有者管理员可控制，但不能读他人内容。`configurationView` 使用 Metadata，新文件接口必须使用 Content，不能因复用配置读取而扩大权限。
- `internal/cli/user_desktop_control.go` 是浏览器到 Core 的精确路由和字段白名单；托管与独立 Desktop 均需覆盖新路由，继续保留身份 generation、CSRF 和 Host/Origin 规则。

本次修订核对了现行 `app.ts` 的 `skillsSettings`、`workcontext/editor.go` 与已运行实例：Work 独立 Skills 和 Core Skill 目录均可为空，但页面把“添加 Skill”渲染成标题，Core 候选常驻且空目录显示“全部已添加”，编辑空态无添加动作。冻结原型的 `collection()`、`emptyContent()`、`addDialog()` 已有真正按钮、选择弹窗和对象搜索；这些是本次必须落实的界面行为。原型仅从示例库复制，尚无用户本机目录导入；直接导入是用户确认“无法把自己的 Skill 添加到 Work”后补充的必要能力，不冒称原型已实现。

## Goals / Non-Goals

**Goals:**

- 以冻结 v5 原型作为界面与交互基线，落实三分类、可搜索对象列表、可点击添加与弹窗、空态动作、文件选择和对象菜单。
- 即使 Core 目录为空，普通所有者也能把自己的完整 Skill 目录直接添加为 Work 副本；不要求管理员预先导入全局目录。
- 按所有者最后确认的决定，“添加 Skill”独立提交新增项，确认后立即可编辑并待应用；其他本地草稿继续保留。
- 通过真实保存确认、Core `pendingApply`、原 Apply Operation 和 runtime 观察驱动状态，保留现有 Package 与脑包能力。

**Non-Goals:**

- 不实现 Core Skill 替换/全局正文编辑、网页从零新建 Skill、配套文件增删改名、二进制编辑或通用 IDE；完整本机目录导入属于新增来源，不等同于文件编辑器建文件。
- 独立 Skill 本次只补本机目录来源，不扩展 ZIP/npm/Git、批量目录导入或自动下载；Pi Package 原有五种来源保持。
- 不恢复 Advanced 的网页 JSON 能力，不改 New Work 的 Advanced，不删除 CLI/API 的既有完整配置或显式重选语义。
- 不新增可变服务器草稿、数据库表、公开 revision、Save Operation 日志、自动重试队列或跨客户端实时协作。Session/Service/模型设置的产品结构不扩项。

## Decisions

### 1. 分开分类、对象与文件

```text
Work A + confirmed runtime
Work settings                      Save all | Apply saved changes
+---------------+------------------+--------------------------------+
| Skills        | Skills [+ Add]   | Skill name / file selector     |
|               | search / objects | empty state: [+ Add Skill]     |
| Pi Packages   | selected object  | text editor / scoped actions   |
| AGENTS.md     | add / install    | local problem and recovery     |
+---------------+------------------+--------------------------------+
```

左侧只保留三个分类；Skills/Packages 内各自选择 Work 对象，Skill 的文件选择器独立于对象菜单。AGENTS.md 直接使用编辑区，不人为增加对象列表。窄屏以分类入口和对象选择器保留相同层级，不能挤成三窄列。

以原型 `collection()` 和 `mobileCollection()` 保留对象搜索、标题旁添加按钮与手机对象选择；以 `emptyContent()` 保留无 Skill 时的直接添加出口。添加按钮打开 `addDialog()` 同类弹窗，Core 列表放在弹窗中，支持勾选确认，不能常驻占据 Work 对象列表。弹窗补充本地目录来源；一次确认处理 Core 勾选或一个完整目录，不混合两个来源形成新事务。空 Core 目录明确显示暂无候选并保留目录导入；“全部已添加”只适用于已确认非空目录，搜索无匹配与读取失败单独表达。真实目录缺少原型示例说明时省略说明，搜索只使用实际可见名称。

原型的分类、对象列表、添加动作及弹窗、编辑器、对象菜单、紧凑工具栏和窄屏路径是必须验收的界面事实。允许使用现有组件与真实状态修正模拟差异，不要求复制原型自绘控件或精确像素；这些差异不授权省略入口、搜索或改回常驻 Core 候选区。

Skill 菜单只有“查看详情”“从此 Work 移除”，触发器与菜单记录明确 `workId/skillName`，配套文件不改变动作范围；使用语义正确的菜单、方向键和焦点恢复。AGENTS 文件导入直接呈现。移除先修改本地选择并提供本次撤销，保存后才改变 desired，Apply 后才改变 active；不承诺跨保存的撤销历史。

不采用上一轮将分类、Skill 和文件树放进同一列的结构，也不引入新组件库。沿用当前浅色 tokens、控件密度、双语文案和统一等待控件；原型的自绘 spinner 不是替代现行 UIL-PENDING-001 局部三点的依据。

### 2. 复用编辑接口，补充所有者目录上传

不修改现有完整配置 PUT 和 `/configuration/skills` 显式重选语义，新增以下 Core 路由；浏览器经既有 `/_desktop/api` 精确映射转发。

| 路由 | 输入与职责 |
| --- | --- |
| `POST /api/v1/works/{id}/configuration/editor/read` | 只读；可选 `skillName` 请求该 Work 的文件列表，`files: [{skillName, path}]` 请求特定文本；同一读取中提供已保存基线、active/desired 的公开事实与文件结果 |
| `PATCH /api/v1/works/{id}/configuration/editor` | 原子提交；可选 `addSkills`、`removeSkills`、`skillFiles: [{skillName, path, text}]`、`agentsMd`、`packageFlags: [{name, enabled}]`，仅处理明确提交目标 |
| `POST /api/v1/works/{id}/configuration/skills/import` | Work 所有者上传一个完整本机目录，原子新增到最新 desired；返回现有 `WorkSettingsState` 确认事实，后续用 editor/read 打开文件 |

读取使用 POST 是为了以受限 JSON 列表承载原保存涉及的多个相对路径，避免长 URL 和每个文件独立读取拼出混合基线；它不创建任务或修改配置，前端 ActionRecord 按只读分类，不能仅按 HTTP method 将它视为修改。仍执行既有 CSRF、授权和精确路由校验，不新增豁免。

新接口先用 Work Content 权限检查目标，再读文件；保存发布前复核当前所有者与有效身份。请求/返回只使用公开 Work/Skill 名称、相对文件路径和明确请求的文本，不给浏览器内部 context ID、制品 digest、宿主路径或平台密钥。

读取先捕获一份 `Store.Configuration` 与其 immutable desired 引用，文件与配置投影来自这同一份记录；不能先读配置再调用一次新的 `configurationView` 拼接不同 desired。runtime 仍由现有 generation/readiness 检查取得，不从文件列表推导。

文本读取复用现有 UTF-8、二进制识别和 1 MiB 单文件编辑限制；内容作为纯文本，不执行 HTML、Markdown 脚本或配套程序。只按需取一个对象的目录及明确文本，不把所有 Skill 正文装进普通目录/配置响应。核对保存时一次读取原请求涉及的字段和文本。保存与核对请求使用现有受限 JSON 解析能力，采用 2 MiB 编码后请求预算；超限在客户端提交前与 Core 独立校验，保留完整编辑，不拆成部分成功保存。正文读取也限制本次总文本量，使核对范围不超过对应可提交的编辑批次。

`packageFlags` 只更新已经安装的包开关，不安装、刷新或删除包制品。字段省略表示不修改；`agentsMd: ""` 与全部移除独立 Skills 保留显式空值语义。未知字段、重复/冲突目标及编辑已移除 Skill 等请求拒绝，不用隐藏默认值补齐。

目录上传复用 `skill_upload.go` 的 SKM-004 multipart 内容协议与有界校验：首 part 为 `directoryName`，后续 `files` 使用编码后的相对路径，保留 2,048 文件、32 MiB 内容、8 MiB 单文件、64 MiB HTTP body、现有期限和两个并发上传限额。只提取已有解析/树校验中两个入口确实共用的部分；Core 全局管理仍要求管理员，新 Work 入口在读 body 前与提交前执行所有者 Content 授权。JSON 编辑的 2 MiB 预算不用于目录二进制上传，也不将上传编码为巨大 JSON。Desktop 代理为同一路径增加精确 multipart 转发，复用现有上传传输、身份及 CSRF 边界，不另建通用上传平台。

浏览器从选择器取得目录 basename 与文件树，展示名称、文件数、大小并预检查；取消不提交。Core 独立检查完整输入，拒绝请求中的宿主路径。同名 Work desired 返回既有 `SKILL_ALREADY_EXISTS`；不静默替换、重命名或新增到全局 catalog。目录上传成功返回确认状态后才加入已保存基线、选择新 Skill 并读取 `SKILL.md`。明确拒绝就地显示原因；响应丢失保留结果未确认及原目标，只读查看当前副本不等于证明原上传成功，不自动重传。

采用独立窄接口是为了同时满足文件内容原子保存、已有副本保留和旧客户端兼容。逐文件保存再 PUT 其他配置会产生部分成功；让现有完整 PUT 在名称变化时改变含义会影响旧客户端；把 context 搬成 workspace 可写镜像则增加持久状态并破坏不可变边界，均不采用。

### 3. 保留未改动制品，重新发布 context

Core coordinator 从当前 desired 捕获全部已有 Skill sources：保留项和未改文件继续采用 Work 自有 bytes，显式 Core 新增名称才读取 enabled catalog，目录导入新增项使用本次已验证的上传树；移除只改变本次目标。重复 Core 选择不刷新已有内容，目录导入同名则拒绝覆盖。对允许编辑的既有文本应用字节修改，复用 `skillartifact`/`safefs` 校验并重建 Skill identity，再通过现有 context publisher 发布完整只读 context。

包 sources、解析后的镜像和运行绑定沿 `package_context.go` 的现有保留路径取得，不重新安装、不访问外部来源。仅新增 names 校验 Core 当前可用性，已有 Work 副本不因 Core 同名项消失被拒绝。

提交复用现有私有 revision/context 竞争检查、授权复核与 candidate 清理；冲突时在现有有界循环内从最新 desired 重建请求明确的增量，保留其他已提交字段。文件只写入本次 staging，既有 active/desired 目录保持不可变。可提取当前提交循环中两条入口确实共用的具名逻辑，不引入通用策略框架。

Skill 身份及完整 bytes 进入新 context，后续 Apply、停止/启动、恢复和 `.work` 导出沿现有链读取。沿用现行存储格式与 Agent 只读挂载，不新增 RPC 或兼容迁移。`pendingApply` 完全采用 Core 确认值；即使显示文本改回原样，也不能仅凭客户端相等宣布已应用。

目录导入复用此提交链，仅向现有构建流程传入已验证的新 Skill source，不先创建 Core catalog 或长期中间制品。失败清理该上传的暂存/candidate，其他上下文与上传保持。无需新数据库表、永久上传记录或 Agent RPC；Apply、重启和导出继续只消费发布后的 Work context。

### 4. 添加单独提交，其他编辑留在同一草稿

从 Core 勾选时提交仅含 `addSkills`；本地目录通过独立 multipart 请求提交所选内容。两者确认后更新已保存基线和对象列表、关闭弹窗并打开新增副本的 `SKILL.md`；多项 Core 选择打开首个新增项。它们不发送 AGENTS、其他 Skill 文件或包开关草稿。前端保留明确变更的草稿映射，再将确认后的新增对象并入基线，不能以整对象克隆覆盖更晚输入。添加入口可见性与动作准入分别处理，必要的等待或写锁可以禁用提交，不能让添加标题代替按钮。

普通“保存全部”提交未保存文件、AGENTS、包开关和本地移除目标的一批增量；成功后只确认本次捕获内容，操作等待中产生的编辑仍保留。新增、保存与 Apply 依据当前身份/Work、既有写准入及 unknown 锁控制提交，不因切换分类换成另一 Work。刷新列表和文件不能覆盖本地草稿。

Package 安装/更新/移除继续使用现有五种来源和受理 Operation，不能用新 editor PATCH 暗中替代。原型的“添加示例包到内存”不进入正式契约；沿现有脏表单保护完成 Package 操作，并在刷新确认后保留其他合法的未保存编辑。原候选详情、真实 checks、日志、loaded/modelVisible 和 Files 源码跳转完整保留。

### 5. 状态投影使用各自确认来源

| 表达 | 依据 | 不能作为依据 |
| --- | --- | --- |
| 当前文件未保存/已保存 | 当前文件编辑与其已确认正文基线 | 同名 Skill 仍存在、另一个文件已保存 |
| 全局未保存 | 明确草稿相对已确认基线的变化 | 当前分类、当前文件单独状态 |
| 待应用/已应用 | 最近成功读取的 Core `pendingApply`，包含 `active=null` | 客户端 JSON 相等、目录名称/版本 |
| 提交中/已受理/应用中 | 原保存请求及原 Apply Operation/phase | 统一伪造的 Preparing、计时器 |
| Work/runtime 加载 | 已验证 Work 状态、runtime generation、loaded/modelVisible | 保存或添加成功、存量 active 名称 |
| 结果未确认 | 原请求缺少可靠结果及后续确认读取 | 关闭提示、撤回编辑、网络后来恢复 |

正常一致时仅使用轻量“所有更改已应用”（及其英文对应），但前提是没有未保存、在途/未知动作或相关失败、当前读取已确认且 `pendingApply=false`；不把它解释为 stopped Work 正在加载。未保存与待应用并列可见。统一使用“保存全部”“应用更改”“检查状态”等动作名；范围通过所属 Work、对象和可访问名称明确，不靠重复解释或无定义计数。

等待在原控件/固定状态位，不重复铺设成功 Alert；部分目录失败属于对应目录，读取失败不冒充空列表或全 Core 离线。有关文件、保存或应用的问题保留在所属区域，未解决错误和安全下一步不能为紧凑隐藏。沿用 `SettingsReadFeedback`、`SettingsSaveReadback`、`ActionState` 和共享 notice 的职责，扩展它们所需的 Skill 内容事实；不增加第二份业务状态机。

明确失败且草稿已恢复到确认保存基线时可以退休该保存失败的呈现。应用失败仅在新的确认读取表明其已不影响当前任务（含 `pendingApply=false` 与必要健康事实）时退出主视界，原 Operation 诊断不删除。运行恢复失败或当前读取未确认不能用内容相等掩盖。

结果未知的“检查状态”只读：按原身份、Work 和本次涉及字段/文件取得一致当前状态。内容一致可确认当前已保存事实；不一致不能断言原请求未执行，应保留编辑和原 unknown 记录，沿现有明确检查/再保存或放弃决策继续，不自动重放。确认读取只更新已保存基线，不覆盖后续本地编辑。Apply 检查继续查原 Operation ID，不创建第二次 Apply。

### 6. 责任模块与同步

| 模块 | 本次责任 |
| --- | --- |
| `packages/contracts/src/work-settings.ts`（新增）及现有导出/生成脚本 | 编辑读写 DTO、严格字段和错误投影；生成 Go schema/DTO 与跨语言夹具 |
| `internal/coreapp` configuration/editor 路由、提交协调 | Content 授权、一致读取、精确增量、现有提交顺序及发布前复核 |
| `internal/coreapp/skill_upload.go` 既有解析与 Work 目录导入入口 | 复用有界 multipart/树校验；按目标 Work 所有者授权并直接发布私有新增副本，不扩大 Core 管理权限 |
| `internal/workcontext`、`skillartifact`、`safefs` | 自有内容读取、保留和校验，新不可变 context 发布；不承担 HTTP/前端状态 |
| `internal/cli/user_desktop_control.go` 与托管 Desktop 消费方 | 精确编辑路由与字段白名单、JSON 预算、目录 multipart 转发、只读请求分类与既有身份/CSRF 边界 |
| `settings-draft.ts`、`models.ts`、`adapter.ts` | 一个 Work 草稿所有者、精确 DTO 与目录上传、关联确认与后续编辑保留；不恢复已移除的 Advanced 序列化 |
| Settings 窄 feature 与 `app.ts` 装配 | 三分类/对象/文件布局、明确动作回调、菜单目标和返回；提取时不传整个 app state/adapter 或反向 import 入口 |
| `settings-read-feedback.ts`、既有 action/notice | 接收业务 owner 的只读事实并呈现，不修改 pendingApply 或取消未知锁 |
| `public/style.css`、`src/i18n/{app,adapter,shared}.js` | 复用 tokens/controls，维护中英文对应文案，移除失效 JSON/Core 替换 UI 字符串 |
| WebUI build/copy/sync 与 `internal/desktopassets/static` | 从源生成资源并重建宿主，包含 CSP、模块导入与实际两种 Desktop 入口验证 |

已移除的 `configuration.ts` / Advanced JSON 不得以另一套可写源恢复；完整隐藏配置留在 Core，前端只维护允许编辑的字段及文件。不把整个 `app.ts` 改造成新的万能 Settings context，也不借本次改造全局菜单、聊天或其他页面。

### 7. Settings 弹层回归

Add Skill 在现有 dialog 容器中使用原生模态，标题和底部按钮保持可达，内容区独立滚动。已发出的添加等待原响应，通过已有动作状态显示结果；此次等待期间暂停改变来源和关闭。明确失败和结果未确认在所属来源各呈现一次。Skill 详情从菜单切换到锚定对象操作按钮的 Popover；Package 详情宽屏为侧栏，窄屏覆盖工作区时限制焦点并支持 Escape 返回。仍使用当前 Work、身份和提交状态的 owner。

在 Desktop 的 Settings 渲染、弹层路由、双语文案及样式内修正目录选择、包来源准入与 Work Skill 搜索；现有浏览器测试覆盖关键路径后生成 Desktop 内嵌资源。Core 接口、保存和 Apply 契约不受这轮回归修订影响。

### 8. Skill 添加结果核验

Desktop 的添加成功回调显式选择 SKILL.md。目录导入在既有内存提交证据中只标记原目录名；只读检查可更新当前 Work 配置，但同名副本不清除原导入的未知状态和写入保护。Core 名称添加及普通文本保存沿各自原有证据核对。复用双语反馈、现有浏览器测试和普通所有者集成夹具，同步嵌入资源。

## Risks / Trade-offs

- **编辑接口增加内容权限面** → 显式 Work Content 权限；全局发现与一般配置响应不加正文；验证非所有者管理员、operator、路径逃逸及身份切换晚响应。
- **共享草稿可能被新增或晚响应覆盖** → 仅提交明确增量，确认更新基线并保留更晚编辑；验证添加时已有草稿、Save/Apply 交错和其他客户端更新。
- **大文件或多文件提交超过预算** → 固定复用文本/JSON 限制，前端检查与后端独立拒绝，整批原子失败并保留编辑；不新增分批保存队列或可调限额。
- **原型与真实行为不完全相同** → 界面与交互以冻结原型为验收基线；真实 Core pendingApply、Package Operation、统一等待控件和已确认的添加即保存优先于模拟脚本，但不能以此省略添加入口或选择弹窗。
- **旧接口仍可显式采用 Core 新内容** → 保留已支持客户端语义；只移除网页入口，新 Settings 不调用该替换路径，不以此扩大为 CLI 重构或协议破坏。

## Migration Plan

已有编辑/保存链保持，先补齐所有者目录导入与精确代理，再按原型校正页面与添加弹窗；同步双语资源、生成输出并重建 Core/CLI 的嵌入 UI。用独立合成安装完成空 Core 目录验收，不向用户现有数据注入演示 Skill。此顺序是实现依赖，不增加发布阶段或双版本兼容层。

不修改存储格式或既有 context。回退 UI/代码保留已经发布的 Work-owned 内容，旧程序继续按现有格式读取；不能从 Core 默认/全局 Skill 重建或清理用户副本。对外发布仍需独立授权。

已有 Requirement/Scenario 标识继续保留。名称仍含 Advanced/JSON 的场景，其新 WHEN/THEN 验证入口已移除及字段保留，不要求保留旧表单、迁移旧 JSON 草稿或增加兼容页面。

## 原型与验证边界

- 稳定设计入口与界面/交互验收基准为 [prototype/index.html](prototype/index.html)，冻结自本次 v5 原型；对照 [桌面](prototype/screenshots/normal.png)、[手机组合状态](prototype/screenshots/mobile-mixed.png) 核对必要结构与操作。可直接打开 HTML 或运行静态 HTTP 服务；数据为合成内存数据，冻结附件本轮不修改。
- 原型未被改造成产品实现。其新增 Skill/包的内存草稿、按对象相等计算 pending、定时完成和示例元数据不定义正式业务行为；新增 Skill 的正式提交时点以用户确认及本变更规格为准。
- 前轮实现与验证记录仅覆盖当时已测试的 Core 复制/编辑路径，未证明空 Core 目录下可添加自己的 Skill，也不能证明与原型交互已对齐。本次更新仅修改规划；tasks 中修订待办及真实目录导入→SDK 使用闭环需后续 apply 完成，不能沿用旧“全部完成”结论。

## 范围审查

- **KEEP**：原型添加入口、弹窗与对象搜索是用户指定基线；所有者目录导入是空 Core 目录下使用自己 Skill 的必要条件；内容授权、原子发布及保存/应用/实际加载分开继续遵守现有契约。
- **SIMPLIFY**：复用 context、提交顺序、读取/反馈及等待组件；目录无元数据就省略；正常状态轻量，不把模拟计时与比较器产品化。
- **REMOVE**：Advanced/完整 JSON 网页入口、Core Skill 替换菜单、重复成功 Alert，以及没有用户任务依据的文件管理功能。
- **DEFER**：网页从零新建、独立 Skill 的 ZIP/npm/Git 来源、通用编辑平台、持久前端草稿、自动重试/恢复队列、跨客户端同步、历史迁移及发行；本次正确性不依赖这些机制。
