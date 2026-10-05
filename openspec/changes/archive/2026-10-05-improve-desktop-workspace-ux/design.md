# Design

## Context

动机与产品范围见 [proposal.md](proposal.md)；行为与验收见四份 delta spec。本设计覆盖 Desktop、Go Core/CLI、Agent/Pi adapter 的实际数据链路，属于跨模块变更。

初版实施前确认的基础约束（原任务 1–8 的范围）：

- Desktop 是 TypeScript 外壳，`action-state.ts` 已将普通读取成功设为不保留，但读取开始仍在模块前插入通用反馈。`openWork` 等导航等待读取后才完成视图切换。本轮补足读取过程，不重做已修复的生命周期协调。
- 工具项目前逐事件追加且丢弃 `toolCallId`；`session-persistence.ts` 只读扁平文本，历史无法和直播稳定合并。`reconcileHTML` 也会移除 details 的 open 属性，展开选择不能靠 DOM 自行保留。
- 模型控件已位于输入组件内，但有独立 Save model 表单；Session 已有 `model_preference_json`，Run 已有 `model_selector_json` 和 `actual_model_json`。SDK 执行明确传入 `thinkingLevel: "off"`。
- 安装的 `@earendil-works/pi-ai` / `pi-coding-agent` 为 0.86.1；可用档位通过 `getSupportedThinkingLevels` 取得，包含模型可能允许的 off/minimal/low/medium/high/xhigh/max，不能按网页文档硬编码。`createAgentSession` 会 clamp 输入，需要在执行前验证并比较实际值。
- `AgentSession.prompt` 默认先执行扩展命令，再展开 Skill/模板。未知 Skill 可被传给模型；内建 /new 等属于终端交互。本轮必须增加明确输入模式和资源校验，不能只把菜单文字交给现有 prompt。
- frozen active 资源在 Agent 初始化时已验证并加载，Run 再创建独立 loader。资源目录查询应复用初始化结果，不重新执行扩展入口。当前 executor 未绑定 interactive UI，完整扩展/TUI 适配不属于基础范围。
- Core 与 Desktop CLI 都使用显式路由、JSON 白名单和当前 Work/实例授权。CLI 目前自行生成 Session/Run 键，浏览器在响应丢失前不知道它们；需要允许本轮调用者保留原键并只读核对。
- 私有 history schema 4 精确验证 SQL 对象。TS `snapshot-brain.ts` 与 Go `internal/workhistory/brain_linux.go` 也严格验证已有 JSON。新增列或只改一端会破坏完整包往返。
- 同 Service/端口 iframe 目前有稳定 key，但祖先重排或移出文档仍可能重载。Focus 必须是现有容器的样式与可见性变化。

本次修订确认的现状：

- 普通读取、Activity、可选聊天契约和完整设置对已经实现；原 37 个完成任务保留其初版范围，新场景由后续未完成任务单独验收。
- `focus-chat`/`return-service` 只改变模块，而 `serviceFocus` 继续隐藏 Work 导航；退出动作只由 Service 工具栏提供，导致仅 Chat 缺少直接退出。修订统一布局所有者，禁止用模块切换实现放大。
- Model/Thinking 容器占整行，发送在另一行；Focus 新增文本按钮与既有图标按钮混用。修订沿现有同类控件解决排列和状态，而非另建视觉系统。
- `resolveProductionModel` 对未知于所选 provider 的 Anthropic-compatible 模型写入 `reasoning:false`。固定 SDK 的 DeepSeek catalog 已有当前 `deepseek-flash` 的 reasoning 与 `thinkingLevelMap`，能力被兼容注册丢弃；能力读取、执行解析与子 Agent 配置必须共用完整 SDK 定义。

## Goals / Non-Goals

**Goals:**

- 一次原子设置对应一次不可变 Run 快照；UI、受理记录与 SDK 执行值一致。
- 同一调用在直播、历史、重连和导入后有可确认身份；无证据的旧关联保持未知。
- 模块读取、命令菜单和布局改变不引入额外执行、未知修改重放或应用视口重建。
- 新能力独立协商，保持原运行契约、固定 SDK 与 SQL schema。

**Non-Goals:**

- 不提供扩展终端 UI、任意 slash 命令、Thinking 原文流或工具参数全集。
- 不用本地缓存绕过所有者、active context 或 Service 准入，不把预览 load 事件当 Ready。
- 不保证 Service 自身刷新、真正切换服务/端口、普通跨模块卸载、跨 Work 离开或外部窗口的应用内存状态；本轮保证同一视口仅因布局切换不重载。
- 本次 propose 只写规划文件；测试执行、构建、镜像发布和运行环境操作属于后续 apply。

## Decisions

### 1. 用内容状态承接普通读取，保留修改协调

依据 DWUI-011/014/019、DUL-WORKSPACE-001。

导航先更新目标路由和稳定外壳，再独立读取 Work 元数据与模块。无数据时在内容位置显示骨架和 Loading…；有本身份已确认数据时保留内容，用局部 Refreshing… 与取得时间表达陈旧性。成功展示内容或真实空态；失败留在模块，提供 Retry。背景读取不进入通用 action 反馈队列，只更新模块数据/错误；持续十秒的前台读取更新原状态说明。

`ActionState` 继续负责对象冲突与未知锁，增加明确反馈呈现策略：内容读取、控件操作、显式检查、修改/持久操作。读取的等待从 adapter 资源状态取得，`renderActionStates` 不再重复插入通用条。显式 Refresh/Check 在原控件附近确认三秒；Unknown/失败无自动到期。状态提示的到期与协调锁严格分离。

初始化先绘制 Opening workspace…；沿原 Cookie-first、票据移除、会话核验、CSRF 和恢复流程获取权限。未核验前只显示中性外壳，不读取或呈现私有缓存。Core/账号/本地会话 epoch 改变清除内容与所有新 UI 状态，GET 去重继续按 epoch 和目标绑定。

选择此方案而非仅删除所有提示：删除不能满足等待、空态与未知恢复；继续通用状态条则仍打断进入任务的路径。

### 2. 增量聊天契约与明确白名单接口

依据 CONV-CHAT-CAPABILITY-001、CONV-SUBMISSION-001。

新增 `CHAT_CONTROLS_CONTRACT_VERSION = 1` 和 ReadinessResponse 的可选 `chat_controls_contract_version = 20`。保留协议 v2、run model contract 1、work feedback contract 1、history schema 4 的既有准入；新字段不加入全局硬性 readiness 门槛。未声明为 0，只有 1 支持本轮接口。

Core 路径以前缀 `/api/v1/works/:workId` 为准；Desktop 同名资源以前缀 `/_desktop/api/works/:workId` 转发：

| 方法与后缀 | 语义与安全响应 |
| --- | --- |
| GET /chat-capabilities | 当前受保护实例的 `{contractVersion: 0或1}`；不返回 context identity |
| GET /chat-models | `{contractVersion:1, models, defaultModel, checkedAt, availability}`；各模型为原公开描述加 `thinkingLevels` 和 `defaultThinkingLevel` |
| GET /commands | `{contractVersion:1, commands, checkedAt}`；项为 `{kind:"skill"或"prompt", command, name, description, sourceName}` |
| GET /sessions/:sessionId/chat-options | `{sessionId, modelRef, model, thinkingLevel, availability, checkedAt}`；原偏好及当前可用性 |
| PATCH /sessions/:sessionId/chat-options | 完整输入 `{modelRef:string或null, thinkingLevel}`；成功返回上述完整确认对象 |
| GET /sessions/submissions/:key | 只读查已有 session_idempotency；返回 `{kind:"session",key,status:"accepted",session}` 或 `{kind:"session",key,status:"not-found"}` |
| GET /runs/submissions/:key | 只读查原提交键；返回 `{kind:"run",key,status:"accepted",run}` 或 `{kind:"run",key,status:"not-found"}` |

新增 RPC 为 ListChatModels、ListSlashCommands、GetSessionChatOptions、SetSessionChatOptions、LookupChatSubmission，复用 AgentContentRequest/Response 与严格命名 JSON Schema。Lookup 的内部请求为 `{kind,key}`，不新增 SQL 表。能力 GET 由 Core 取得并核验当前 Agent Readiness；不能仅凭 RPC 未报错推断支持。

现有 GET /models 与 PATCH /sessions/:id/model 的形状继续兼容。Session 的 protobuf 增加 `thinking_level = 8`，Run 增加 `thinking_level = 17`；新公开 HTTP 投影在已有模型描述之外单独返回 thinkingLevel，不把私有实际模型 JSON 直接透传。旧字段与编号不改。SubmitRunRequest 新增 `optional string input_mode = 6`；SessionMessage 增加顺序 blocks=5、run_id=6；ToolEvent 增加安全结果预览 JSON=6。新消息字段使用剩余编号，不复用既有 tag。

修改 `packages/contracts`、`proto/agent.proto` 后按 `make generate` 更新 TS/Go RPC、原生 HTTP DTO 和验证样例。Core `conversation.go`、`internal/agentclient/client.go`、CLI `user_desktop_control.go` 同步增加方法/路径/请求与返回白名单。修改复用 transient mutation 保护，与 Stop/Apply/身份撤销竞争继续按原规则拒绝；所有读取经过 Work Interact、运行实例、context 和 Session 归属校验。历史读取保持原只读 context 规则，设置只允许可继续 Session。

新 Desktop 在能力为 0 时保留原文本聊天、原模型 API 与安全历史；资源命令、Thinking 设置以及原键查询明确不可用，Focus 与前端可执行网页动作独立可用。旧 Core/CLI 缺新路由时，仅在本次身份下 Work 已确认可读的前提下降级，不把真正 Work 404/鉴权失败隐藏为兼容。普通无 slash 文本走原接口；没有字面模式能力时 Send as text 仍展示但禁用并说明原因，不能让旧 SDK 执行未知 slash。

浏览器对新的 Session 创建/Run 提交分别生成 UUID 原键，CLI 白名单允许可选 idempotencyKey/submissionKey 并转发；省略时继续原随机生成规则。键最长 256 字节，限定现有可接受格式并安全编码到查询路径。原键按身份/Work/意图保存在浏览器当前状态，任何自动导航不得生成替代键。not-found 只表示查询时没有持久映射，不证明原在途请求未写入；保持未知并允许再次只读核对。找到记录后用户明确继续，不自动完成此前未受理的后续消息发送。

选择独立接口而非扩大旧 /models 返回结构或提升全局必需版本：减少严格旧客户端破坏，避免正常固定镜像突然不能运行。

### 3. Session 设置对与受理时 Thinking 快照

依据 DWUI-MODEL-001、CONV-MODEL-001、CONV-RUN-001、CONV-CHAT-HISTORY-001。

Model 候选保持 Core 已启用与凭据可用准入，再由固定 Pi SDK 解析；不开放整个 SDK 目录，也不从浏览器或实时 Provider 文档造档位。`AgentRunModels` 的能力投影与 executor 共用解析定义，档位用 `getSupportedThinkingLevels(model)`，默认建议用 `clampThinkingLevel(model,"off")`；真正非 reasoning 与确定性 fixture 仅 Off。空/非法或未经确认的能力按现有模型不支持/列表不可用错误处理，不伪造成功。

兼容注册按两层解析：原 provider/id 已存在时保留完整 SDK 定义，仅覆盖已配置端点；已配置的官方 DeepSeek Anthropic-compatible 端点且 provider 为 anthropic 时，按相同模型 id 取固定 SDK deepseek 定义，保留名称、reasoning、thinkingLevelMap、模态与上下文/输出限制，执行 provider/凭据绑定和 anthropic-messages 协议保持原值。匹配只允许规范化官方 HTTPS authority 与 /anthropic 路径，不按任意 URL 中包含 deepseek 或跨 provider 同名猜测。未获 SDK 证据的任意 custom 模型不新增 Thinking 能力，旧普通接口兼容规则保留。

该已确认兼容模型使用固定 SDK 的档位映射和受理快照生成 Thinking 请求语义。保留 Anthropic Messages 传输、认证、上下文、工具与 SDK prompt；通过该模型范围内的请求选项/最终 payload 适配显式发送 Off 的 `thinking.type=disabled`，非 Off 发送 `thinking.type=enabled` 和 `output_config.effort` 的 SDK 映射值，关闭时不发送冲突 effort/budget。平台设置转换在既有扩展 payload 链之后核对，不能让扩展或 Provider 缺省将记录值变成另一档位。其他 SDK provider 继续原生请求序列化；不升级 SDK、不改 Core 配置或静默换模型/协议。实际请求在受控 HTTP fixture 中按 SDK 支持集合逐档验证，不能只检查 `session.thinkingLevel` 内存值。子 Agent 配置保留同一可序列化 SDK capability/compat 元数据，手动偏好仍不覆盖子 Agent 的 Work 默认绑定。

Session 的已有 model_preference_json 继续存完整已解析模型及 availability，增加可选 thinkingLevel；null/无记录按 Work 默认 + 旧 Off 偏好读取。PATCH 必须同时提供 modelRef 与档位，解析并验证可用性后一次更新 JSON，不分两次写；恢复查询返回整组值。原模型专用 PATCH 保留已保存 Thinking，目标模型不支持时返回 THINKING_LEVEL_UNSUPPORTED，不静默调整。可用性读回不写入替代模型或新档位。

新 Desktop 模型选择变化时，若现有临时档位不支持目标模型，采用目标的已确认建议值并在控件旁解释；这是用户选择模型后可见的完整目标设置，不是服务端接受时的暗中 clamp。旧 Session 的 Off 不兼容则必须明确选择修复；未选择不自动迁移。

Run 的 actual_model_json 在已有描述上增加 thinkingLevel。受理捕获一次完整 Session 偏好，解析为有效模型/档位并持久接受；不在异步解析后再次单独读取另一半设置。显式模型覆盖沿原选择器语义解析模型，使用原 Session Thinking 并检查兼容；自动 Run 完全忽略该偏好，使用 Work 默认与 SDK 对旧 Off 的有效 clamp 值。executor 将受理值传给 createAgentSession，确认 session.model 与 thinkingLevel 与快照一致后才 prompt；不一致安全失败。

调用凭据 resolver 前剥离 thinkingLevel，继续使用原模型指纹比较，避免新元数据破坏 expected model 校验。公开 actualModel 沿原安全描述函数；thinkingLevel 单独投影。旧 Run 没有该字段时界面按历史 Off 表达，不按现有 catalog 重算旧事实。

inputMode 放入已有 model_selector_json 的可选扩展，使用新增 `RunSubmissionSelectorSchema` 验证；原 `RunModelSelectorSchema` 形状保持原样。旧请求的 digest 保持 `{sessionId,prompt,selector}` 原序列化，省略新字段不能被补成 text/legacy 再散列。明确新模式纳入 selector 与摘要。重放先按原摘要找已有 Run，再检查模型、设置、命令目录和单槽。

TS snapshot-brain 与 Go workhistory 同步抽取、校验可选 thinkingLevel/inputMode 后仍严格验证其余描述和选择器；仅允许规定枚举，其余未知键仍拒绝。schema.sql、schema-objects 和 SQLite user_version 不变化；SDK v3 history 保持原文件，不做格式迁移。新字段随现有结构化记录和 SDK 文件进入完整包，导入不回放。

选择 JSON 增量而非新增 SQL schema：本版 schema 4 和完整包固定约束不允许自动升级，现有列足以保存可选元数据。

### 4. Chat Box 自动保存与发送的状态机

设置控件位于 textarea 内底栏，Model、Thinking 在左，Enter/Send 右对齐；宽度足够时同行、等高并垂直居中，名称可截短但完整名称可取得。360px 允许紧凑控件换行，发送保持可达；错误/未知反馈占独立局部行，不能挤走主要控件。选项与 slash 菜单复用现有 menu-list/选择器行、popover/dialog 焦点与轻量控件样式，不建立独立设计系统；/model 和 /thinking 打开同一实际入口，Esc 只关闭当前菜单。标签使用 Model、Thinking、Saving…、Settings unconfirmed、Check chat settings。菜单打开不修改；选择后自动保存，正常成功由控件值承接，Saved 如需出现最多三秒。

Service identity 作为保留原值的次级输入选项，相关隐私/数据来源说明按需查看；命令模式在该入口说明不附加身份，必要的失败和未知恢复仍直接可见。Activity、选项状态与 slash 菜单沿用既有 English 对象/状态语言，技术 ID 与修订留在详情，不把永久技术说明置于日常输入底部。

每个身份/Work/Session 保存 confirmedPair、draftPair、draftRevision、在途快照及 phase：

| 状态 | 行为 |
| --- | --- |
| loading | 读取能力/偏好；控件局部等待，消息和草稿可读 |
| clean | 显示已确认完整值，可按 Run 准入发送 |
| dirty | 有明确新选择；当前 Session 且无在途/未知请求时立即保存 |
| saving | 一次完整 PATCH；允许继续选择新草稿，仅串行保留最新待保存值；发送禁用 |
| rejected | 保存可证明被拒绝，保留目标与已确认值；Retry settings / Use saved settings 为明确动作 |
| unknown | 不再自动保存/发送；Check chat settings 只读原 Session，提示原保存仍未确认 |
| unavailable | 模型/context/契约不可用；保留草稿并解释下一步 |

saving 成功只确认发出的 revision；同一 Session 仍被选择且有更晚明确选择时，串行保存最新 pair，中间版本不排成隐藏消息队列。对象切换后取消未开始的自动保存；已发请求继续归属原对象，晚响应只能更新原缓存。切回来后尚有本地未保存目标，提示用户明确保存/恢复，不从导航自动提交。

unknown 重查得到实际完整 pair 后显示该事实，停止自动处理旧待保存值；若用户还想使用本地目标，需要再次明确选择或 Retry settings。离开视图不释放未知锁。各请求带身份 epoch、对象、revision 校验；清除身份时全部清除，不让旧完成释放新锁。

无 Session 的控制保存在 Work 输入草稿上，默认为 defaultModel + defaultThinkingLevel，并注明 For new session。Send 的明确意图顺序为：一次幂等创建 Session → 确认完整设置 → 一次新 Run 受理。/new 仅完成创建和默认设置，不继承现有 Session 的手动偏好。步骤失败保留已确认 Session ID、原键与草稿；结果未知通过第 2 节查回或设置 GET，恢复不自动继续发送。当前活动 Run 存在时仍可改下一条设置，Send 按单槽禁用。

多个客户端的完整 PATCH 以服务端提交次序为准，接受取一组完整快照；本轮不承诺跨窗口草稿同步。受理后 UI 展示 Run 返回的真实设置，即使其他客户端刚改变偏好也不能把本地控件值当执行事实。

### 5. 基础命令目录、输入模式和网页动作

依据 DWUI-COMMAND-001、CONV-COMMAND-001。

Agent 初始化 `loadValidatedWorkContext` 从已加载 loader 的 skills/prompts 生成安全目录并保存，不向目录 API 暴露 loader、文件路径或内容；包括 standalone 已加载 Skill 与 enabled package 资源。忽略 disableModelInvocation 对人工命令的隐藏：该属性限制模型自动发现，人工调用仍使用实际已加载 Skill。只读取名称/说明，sourceName 使用公开包名或 Work skills。

保留 /new、/resume、/model、/thinking、/settings 作为网页动作，目录中同名模板不开放。模板与当前 extensions.commands 同名也不开放，UI 可在资源不可用说明中解释冲突；合法 Skill 使用 /skill:name，不造别名。

对显式 command 模式在新受理前核对目录/context，执行绑定实际 loader 后再校验 Skill/模板及命令名未被 extensionRunner 注册。预先检查 Skill 文件可读与模板可展开，禁止 SDK 未找到资源时 pass-through；固定资源校验或扩展展开错误触发原 Run 失败/abort，不能生成一次 fallback 普通 prompt。合法调用仍通过 SDK prompt 的 Skill/模板展开，不运行任意扩展 handler。text 模式使用 `expandPromptTemplates:false`；旧省略模式保留原 SDK 调用行为。记录 prompt 前后消息边界，只接受本次新 assistant 结果；无新结果形成原 Run 失败，不复用 findLast 的上一轮回答。

菜单搜索按命令名/名称/说明过滤，稳定顺序为网页动作、Skill、模板，类别内按名字排序；过长描述单行省略，完整无障碍名称保留。首个非空白 / 前的空白在 command 解析时规范化为无前导空白；原 prompt 仍用于稳定摘要，参数正文不改。选项仅替换命令名范围并将光标置于其后，已有参数原样保留。原始范围与 draft revision 用于避免异步目录响应覆盖新输入。

网页动作仅接受整条输入去掉首尾空白后为一个已知命令；额外参数错误。动作处理共用现有 newSession/session picker/控件菜单/Settings guard：
- /new：创建一个新 Session 并确认新会话默认设置；原命令来源草稿只在动作可靠完成时消费。
- /resume：打开本 Work 的 Session 选择器，用户明确选择且历史取得后成功；只关闭选择器视为取消。
- /model、/thinking：打开本 Chat Box 控件；未选择/关闭不消费命令，设置确认后成功。
- /settings：先退出 Focus，再经已有脏编辑导航保护打开当前 Work Settings；导航成功消费命令，取消保留。
成功只清除与发起 snapshot 相同的命令草稿，不清除后来的编辑或其他 Session 草稿。网页命令不写入用户消息、不调用 SubmitRun。当前 Run 不因 /new 或 /resume 取消。

Enter/Tab 在菜单打开且有选中项时只填入，用户再次明确提交才执行；箭头、Esc、IME、Shift+Enter 按规格处理。菜单关闭后即使用户直接输入已知命令也需按实际目录核对。未知提示提供 Send as text；不支持字面契约时明确禁用。资源目录失败只影响资源命令，不阻塞普通文本及已可用网页动作。

命令模式不附加现有 Selected service 身份后缀：控件就地说明 Service identity is not added to commands，保留用户原 toggle 以便普通文字恢复。避免把身份后缀误作模板参数，不新增一个与当前范围无关的 prompt context 协议。

选择 headless SDK 的已验证资源展开与网页入口，而非接完整 Pi RPC/TUI：基础范围有现成动作和数据源，扩展 UI 请求、终端组件和纯扩展无模型回合需要另一轮协议适配。

### 6. 有序消息投影与 Activity 身份

依据 CONV-TOOL-HISTORY-001、DWUI-ACTIVITY-001。

新增公开顺序块类型 text、tool-call、tool-result，包含稳定 blockId、文本或调用 ID/名、结果预览与 error 标志；每个消息仍保留 entryId/role/text，旧客户端可继续读取扁平文本。工具预览为 `{kind:"text"或"non-text"或"unavailable",text?,truncated,isError}`，UTF-8 安全截到 64 KiB；私有原文与完整包不裁剪。元数据不公开参数、Thinking、路径或 credential。

每个新 Run 在继续的 SessionManager 上、prompt 前 appendCustomEntry("piwork-run",{runId})。读历史沿 entry.parentId 查最近标记，验证 Run 确属同一 Work/Session 后关联，不相信文件任意标记。标记不进入模型上下文，不改变消息树关系。旧历史如可通过该 Session 已保存事件中的唯一 toolCallId 确认 Run则关联；没有唯一证据时只使用局部 entry/block 身份，不按工具名或时间猜测。

Desktop 建立有序消息投影，而非逐事件消息数组 push：
- 直播以 runId + toolCallId 识别调用；开始建立一个项，结束原位更新。sequence 去重继续沿现有 cursor，重复/过期开始不能覆盖已确认结束。
- 连续调用的 Activity key 为 runId + 第一调用 ID；正文建立边界，不跨 Run 合并，结果原位补入，不新增重复消息。
- 无所属 Run 的旧结果按稳定 entry/block 独立显示，不与直播猜测合并；只读历史保留原顺序。
- authoritative Session 历史与 Run 事件按 ID 合并；终态读取替换该 Run 的临时正文，避免 finalText 与 SDK final assistant 重复。410 保留原恢复路径，只读历史/原 Run，不重发 prompt。
- `details` 绑定稳定 data-message/data-activity key，展开值由 Work/Session 的显式 map 控制，监听 toggle 更新；不能依赖 reconcileHTML 自动保留 open 属性。
- 手动上滚保存可见锚点与偏移；仅在原已处于底部或用户 Jump to latest 时跟随。隐藏 Chat 或改布局之前捕获 Desktop 滚动位置，显示后恢复。

摘要用 Activity · N tools 及 Running/Completed/Failed/Unconfirmed，失败数和首个可理解错误在折叠状态可见。空集合不显示；缺少结束只标未确认，即使 Run succeeded 也不伪造结束。展开输出按文本转义呈现；已结束工具不会每次更新抢焦点或触发 alert。

选择有序投影而非把所有工具搬到全局侧栏：保留回复与调用的实际关系，同时降低 Chat 主视图占用。

### 7. 统一 Focus 返回所有者，保留稳定容器与浏览器状态

依据 DUL-002、DUL-WORKSPACE-002、DWUI-FOCUS-001、BSA-FOCUS-001。

同一 Work 工作区采用一个布局状态 `workspace | service-chat | service-only | chat-only`，保持当前模块选择 `view.tab` 与放大布局分开。常规 Chat 模块仍是 workspace；Focus chat 不再通过改 tab/重建主区域实现。首次进入任一专注布局保存 workspaceReturn（原区域与焦点来源）；从非 chat-only 放大 Chat 时保存一次 chatReturn（放大前布局），重复操作不覆盖返回目标。Service/端口、Session、文件编辑、草稿与阅读位置继续属于当前 Work，不把快照恢复变成撤销用户明确的新选择。

| 来源与动作 | 目标及返回规则 |
| --- | --- |
| workspace 中 Service Focus | service-chat；保存常规返回位置 |
| service-chat 的 Hide chat / service-only 的 Show chat | service-only / service-chat；不改首次返回位置 |
| workspace 或 Service 专注中的 Focus chat | chat-only；保存放大前布局，原内容只隐藏 |
| chat-only 的 Restore layout | 恢复 chatReturn；若为 workspace 则恢复其导航，否则保留专注 |
| 任一专注布局的 Exit focus | 恢复 workspaceReturn 和常规导航，清除临时专注返回状态 |
| Files、Settings 或正常模块导航 | 先执行退出专注，再沿原容器/脏编辑规则导航 |
| Work/身份切换 | 清理本页面临时布局和返回锚点，不使用旧 Work 状态 |

当前主内容和单一 Chat 保持同一稳定工作区根；Service 工具栏、iframe 及祖先在布局切换中不搬移、不销毁、不改 src，不重新 ensureServiceEntry。chat-only 隐藏原主内容、Service 头部与导航，由仍可见的 Agent 头部提供 Restore layout 与 Exit focus；Service 专注视图由原工具栏提供退出，保持共享布局所有者和一致处理函数。Focus 状态不取决于一个可能消失的工具栏或硬编码 return-service。正常跨模块导航、真实服务切换及资格失效继续按原 key/准入规则处理。

Focus/恢复/退出/显隐/全屏复用现有 Open/More 的 `icon-button quiet` 视觉角色与现有 SVG 图标，统一尺寸、间距、hover/focus/disabled；开关使用 aria-pressed，动作有 English tooltip/aria-label。退出与恢复保持可见，不藏在菜单。Service 布局保留名称/真实状态与访问动作；仅 Chat 保留 Work/Agent 身份、Session 与两种返回动作。任何异常壳均保留所属对象、真实原因及退出，不显示虚构成功。

小于 900px 的 service-chat 使用同一 Chat 覆盖层；隐藏变为 service-only，运行、失败与未知仍由紧凑状态表达，事件不自动打开 Chat。chat-only 是同一节点占主区，恢复回原覆盖/布局状态；360px 可达所有必要图标和输入控件，无横向溢出。捕获并恢复 Chat 阅读锚点、Activity 展开及触发焦点；来源已不可见时聚焦目标布局可用返回控件，不将焦点留在隐藏节点。

真实 `document.fullscreenElement` 为独立浏览器状态，同一稳定工作区根使用 requestFullscreen/fullscreenchange。所有适用专注布局都有 Full screen / Exit full screen；失败就地说明且保留布局。Exit focus 在本根全屏时先请求退出，确认后恢复常规；拒绝时保留原布局和可重试出口。Esc 顺序为最上层 dialog/菜单（含 Model/Thinking/slash）→浏览器全屏的原生退出→chat-only 恢复放大前布局→窄屏 Chat 覆盖层关闭→退出剩余专注，单次按键不跨多层；跨源应用内键盘不作保证，图标出口持续可达。

正常独立 /app 仅使用 workspace/service-only 和相同图标/全屏/退出处理，不提供 Chat、不自动创建/读取 Session；退出恢复本窗口身份与 Back to Work。禁止嵌入的直接应用页、安全头、origin、入口授权和两秒撤销边界保持原规则。

选择统一所有者和原位可见性变化：仅给 Chat 再补一个跳往 Services 的按钮无法恢复 Files 来源或保存 iframe；创建 portal/新 iframe/重复 Chat 会破坏未保存内容和执行观察。本方案同时解决回退闭环与已有样式不一致。

### 8. 统一错误与未知结果的可见语义

| 条件 | 响应/行为 |
| --- | --- |
| 新契约为 0/不支持 | 新接口 501 CHAT_CONTROLS_UNSUPPORTED；功能就地不可用，基本能力独立 |
| 请求形状、未知枚举、网页命令参数非法 | 400 INVALID_REQUEST；不写入，字段/输入处报错 |
| 新资源命令不存在/被占用 | 400 SLASH_COMMAND_UNKNOWN / SLASH_COMMAND_UNSUPPORTED；不受理 Run |
| Thinking 不兼容、模型失效 | 409 THINKING_LEVEL_UNSUPPORTED / 原 MODEL_UNAVAILABLE 或 MODEL_NOT_SUPPORTED；不部分保存或降级 |
| 旧 Session context、单槽占用、生命周期竞争 | 保持原 SESSION_CONTEXT_UNAVAILABLE / WORK_BUSY / 工作区准入错误与状态码 |
| 目录/真实模型能力读取失败 | 503 CHAT_COMMANDS_UNAVAILABLE / 原 MODEL_LIST_UNAVAILABLE；保留输入与 Retry |
| 已受理后的资源校验或 SDK 值不一致 | 原 Run failed，安全诊断 SLASH_COMMAND_UNAVAILABLE / CHAT_OPTIONS_UNAVAILABLE；不会另发 prompt |
| 网络断开、超时、非法响应、不能证明未写入 | UI unknown；只读原键/原 Session 查询，禁止自动重提 |
| 授权/来源/归属失败 | 现有 401/403/404 安全投影；不以新功能错误掩盖授权恢复 |
| iframe 未确认/全屏拒绝 | 本地可恢复状态；不发 Service 修改、不改变真实 Run 状态 |

所有新错误只返回安全说明，不输出堆栈、宿主路径、内部上下文或 credential。新增错误在 TS/Go/CLI 同步投影，不能被统统变成写入明确失败而解除 unknown。

## Risks / Trade-offs

- [iframe 祖先重排会重载] → Focus 使用原位样式变化，浏览器以文档加载计数、节点身份、表单值及源地址验收。
- [活动事件与 SDK 历史顺序不同/重放重复] → 稳定调用 ID、有序块、原 Run 标记、序列去重；没有证据不合并。
- [选择速度快或响应丢失造成设置串扰] → 完整 pair、Session 内串行、revision/epoch 过滤、未知只读核对；发送只使用确认事实。
- [SDK clamp、兼容注册或 Provider 缺省导致展示与执行不一致] → 统一 SDK 定义、保留兼容映射，受理/初始化比较并逐档捕获真实请求；能力未知不伪造 Off，历史事实不重算。
- [Focus 与模块状态组合产生死胡同] → 单一布局所有者、两种返回目标、持续可见图标出口，验证 Focus → Focus chat 完整组合及 Files 来源。
- [局部改造产生另一套 UI 语言] → 复用现有图标/选择器/菜单角色，宽屏与 360px 检查对齐、tooltip、键盘及错误可达。
- [新可选 JSON 不被旧校验接受] → TS/Go 校验与完整包往返同批发布，SQL 保持不变；不承诺旧二进制读取包含新字段的包。
- [旧固定 Agent 没有新功能] → 独立可选能力，原 API 降级与明确 UI 原因；升级镜像仍需原显式配置/Apply 流程。
- [静态成本低估] → 基础 slash 的低至中等成本只覆盖本轮目录、网页入口与 SDK 展开；模型/Thinking、工具持久关联、键查询和端到端兼容属于跨模块中等成本，不承诺具体人日。
- [仅 Service 模式隐藏对话进度] → 最小工具栏显示 Running/Failed/Unconfirmed，Show chat 返回同一上下文。

## Migration Plan

1. 实施新增协议、严格契约、Agent 持久化/执行及 Go 校验；不新增 SQL migration 或改包格式。运行 make generate 后核对生成差异没有 schema version 变化。
2. 完成 Core/CLI 白名单、新键核对及旧能力降级，再交付 Desktop 读取、Activity、命令、设置与 Focus。新接口可增量部署，UI 只在能力确认后启用。
3. 在隔离测试环境构建包含新 Agent 的镜像与 Desktop Go embed，用旧包、新包及旧 Agent 分别验证；不自动重启或替换用户 Work。
4. 发布同一版本的 TS harness、Go Core/CLI 与内嵌静态资源。现有 Work 使用固定镜像时功能可按契约降级，使用者仍通过原正常镜像配置和 Apply 启用新 Agent。
5. UI 回退可保留新 Agent/Go history 校验，只关闭新增入口。包含新字段的历史不删字段、不降 schema；完整回退旧二进制只对未产生新字段的 Work 安全，已产生新字段需保留兼容运行版本或使用变更前完整备份，不能对原历史做自动逆向迁移。

## Verification

实施后按 tasks 执行，规划阶段仅做 OpenSpec 严格验证：

- 契约/Agent/Pi adapter：模型能力真实值、原子保存、默认-only、旧 Off、新 Run 实际值、自动请求、输入两种模式、SDK 展开、无新 assistant 失败及原摘要幂等重放。
- work-store 与 Go workhistory：schema 4 不变、合法旧包/新字段往返、非法值/未知字段拒绝、Run 标记安全关联、history 原文与非回放边界。
- Core/CLI：新增接口白名单、原键转发/只读核对、所有者/跨 Work/context/实例撤销、未知语义与旧 Agent 独立降级。
- Desktop 受控浏览器：延迟/空/失败/恢复、连续设置与晚返回、命令键盘/IME/草稿、事件重复/410/历史合并、360px 和宽屏；Focus → Focus chat → Restore layout → Exit focus、直接仅 Chat 退出、Files 来源、菜单/全屏优先级与异常出口；节点/加载计数/表单/草稿/阅读位置；底栏同行等高及现有图标/菜单状态一致。
- SDK 模型与受控请求：候选能力等于固定 SDK 在 Core 准入下的支持集合，内建/已知兼容/未知模型与真正非 reasoning 区分；Off 和各可选非 Off 的实际请求、SDK 值和 Run 快照一致，子 Agent 能力不丢失。
- 真实 Go Core 浏览器与隔离运行环境：新资源目录/设置/执行/完整包往返串联，确认静态 embed 与固定 Agent 能力一致。仅运行与本轮影响相关的 checks，失败才扩展检查。
