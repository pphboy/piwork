# Tasks

原第 1–8 组的 37 项完成标记仅代表初版任务及其原验收范围；本次规划补充的返回、SDK 能力与 UIUX 一致性由第 9–12 组未完成任务承接，不能沿用初版通过结果认定已交付。

## 1. 增量协议与严格契约

- [x] 1.1 为可选聊天契约、模型 Thinking 能力、命令目录、完整设置对、原键查询、输入模式及工具块增加 TS Schema/类型；保留原模型选择 Schema，新增私有 RunSubmissionSelectorSchema；用 contracts 验证合法空目录、default-only、未知键、非法档位与旧请求样例（CONV-CHAT-CAPABILITY-001、CONV-MODEL-001、CONV-COMMAND-001、CONV-SUBMISSION-001）。
- [x] 1.2 按 design §2 的编号增加 proto 字段和五个 RPC，执行 make generate 同步 TS/Go RPC、HTTP DTO 与验证样例；运行 contracts unit 和 Go contracts/wire 测试，确认旧 tag、协议 v2 与三个原版本常量未改变，schema 4 的 SQL 生成物无差异（CONV-CHAT-CAPABILITY-001、CONV-CHAT-HISTORY-001）。
- [x] 1.3 在 Agent Readiness 报告可选 chat contract 1，Core Agent client 独立判断新能力，不增加全局硬性门槛；以新/旧 Agent、未知契约、旧实例和初始化未完成的 readiness 测试验证原准入与新功能边界（CONV-CHAT-CAPABILITY-001）。
- [x] 1.4 更新 docs/sdk-adapter.md 的可选协议与安全公开字段说明，链接本变更及对应规范；核对文档中的新增字段/RPC 与生成类型一致，不添加另一份 Desktop UI 规范（CONV-CHAT-CAPABILITY-001）。

## 2. Session 完整设置与真实 Thinking 执行

- [x] 2.1 扩展 AgentRunModels 的真实 SDK 能力投影，提供各候选与默认模型的 thinkingLevels/defaultThinkingLevel；用 SDK 与 deterministic fixture 测试验证非 reasoning 仅 Off、扩展档位、default-only、能力读取失败且不返回密钥/路径（CONV-MODEL-001）。
- [x] 2.2 在 Agent Session 服务原子读写 model_preference_json 的完整模型/Thinking；旧模型 PATCH 保留原档位，不兼容时完整拒绝；以 unit 测试覆盖旧 null/Off、不可用偏好、错误无部分保存、context 不匹配及保存/读取不改 Work 配置（CONV-MODEL-001）。
- [x] 2.3 在 Run 受理捕获一组实际模型/Thinking，并持久存入现有 JSON；executor 传入该快照并校验 SDK 实际值，凭据解析剥离新元数据；用真实 SDK fixture 验证当前 Run 不变、后续手动设置、自动请求默认、显式模型覆盖不兼容拒绝（CONV-RUN-001、CONV-MODEL-001）。
- [x] 2.4 扩展已接受 selector 的可选 inputMode；旧省略请求保留原 digest，显式模式进入摘要，重放先查询再解析当前设置；用 lost-ack、模式冲突、catalog/Thinking 变化后重放测试确认同一 Run 且无二次模型/工具执行（CONV-RUN-001）。
- [x] 2.5 同步 packages/work-store/src/snapshot-brain.ts 与 internal/workhistory/brain_linux.go 的可选字段严格校验；用 TS/Go history 测试验证 schema 4 不变、旧字段缺省、合法新字段保留、未知/非法字段拒绝，并更新 docs/work-package-format.md 的增量 JSON 和版本边界说明（CONV-CHAT-HISTORY-001）。

## 3. Agent 基础资源命令与可恢复工具历史

- [x] 3.1 初始化时从 validated active loader 建立并缓存安全 Skill/Prompt 目录，排除保留网页名、扩展冲突与不可解析 token，不重新执行扩展；以 package-resources/application 测试确认 standalone/enabled 资源、desired 未 Apply、禁用包、空目录和安全来源名称（CONV-COMMAND-001）。
- [x] 3.2 在明确 command 模式受理/执行前校验实际资源、context 与扩展冲突，复用 SDK 展开；text 模式禁止 slash 展开，省略保留旧行为；添加 SDK 测试覆盖参数/首个分隔符、字面 slash、未知/不可读资源、不运行扩展 handler、没有本轮 assistant 时失败（CONV-COMMAND-001）。
- [x] 3.3 在新 Run 的 SDK Session 写入安全 run 标记，扩展持久消息的稳定顺序块、调用/结果和有界结果预览；历史关联验证同一 Work/Session，仅用唯一旧事件证据回补；用 Pi adapter 测试覆盖正文工具交错、恶意标记、旧无关联、非文本、UTF-8 64 KiB 截断且私有原文完整（CONV-TOOL-HISTORY-001）。
- [x] 3.4 同步 Agent、protobuf 和 Core 历史/事件公开投影，保留旧 role/text 接口；用 wire 与 Session history 测试验证 live toolCallId/结果、历史 Run 关联一致，没有参数全集、Thinking 原文或私有元数据泄漏（CONV-TOOL-HISTORY-001）。
- [x] 3.5 更新 docs/sdk-adapter.md 的输入模式、基础命令范围、SDK history 标记和安全投影说明；执行 agentd/pi-adapter 相关 unit 与 SDK fixture，确认当前固定 SDK 下通过，不升级依赖（CONV-COMMAND-001、CONV-TOOL-HISTORY-001）。

## 4. Core / CLI 白名单与原键恢复

- [x] 4.1 实现 design §2 的 chat-capabilities/chat-models/commands/chat-options HTTP 路由和 AgentContent RPC 转发；所有修改复用 transient mutation 和原所有者/实例准入；用 Core/client 测试验证方法/JSON 白名单、越权、跨 Work/context、实例替换与明确不支持错误（CONV-CHAT-CAPABILITY-001、CONV-MODEL-001）。
- [x] 4.2 在 WorkStore 原 session_idempotency 与 Run 映射上实现只读 LookupChatSubmission，并提供 sessions/runs/submissions/:key 路由；用丢响应、not-found 在途、其他对象/身份查询测试确认只返回原持久事实，不创建或解除无关未知锁（CONV-SUBMISSION-001）。
- [x] 4.3 扩展 Desktop CLI 同名路由与严格参数白名单，允许可选 Session/Run 原键和 inputMode，省略保留原随机键规则；用 user_desktop_control/client 测试验证 CSRF、非法输入、原键端到端透传、旧接口与状态码兼容（CONV-SUBMISSION-001、CONV-RUN-001、CONV-CHAT-CAPABILITY-001）。
- [x] 4.4 同步新错误的 TS/Go/CLI 安全映射和新能力 0 的降级；以 400/409/501/503、未知响应与旧 Agent 测试确认不把超时当明确拒绝、不自动升级镜像；更新 docs/user-cli.md 与 docs/sdk-adapter.md 的端点/兼容说明（CONV-CHAT-CAPABILITY-001、CONV-SUBMISSION-001）。

## 5. Desktop 低干扰读取与 Activity

- [x] 5.1 将打开 Work、模块/Session/详情及深链接改为立即绘制目标外壳与局部读取状态；调整 ActionState 呈现策略而保留协调锁；以受控延迟浏览器验证首次骨架、旧缓存取得时间、模块独立失败、空态、十秒等待和正常后台静默（DWUI-011、DWUI-019、DUL-WORKSPACE-001）。
- [x] 5.2 将授权初始化改为 Opening workspace… 外壳，保留 Cookie-first、票据移除、CSRF 与原恢复；浏览器验证初始化前无私有内容、快速成功无检查流水、授权缺失/CLI 失联与显式检查局部确认，旧修改不自动重发（DWUI-014、DWUI-019）。
- [x] 5.3 建立 Desktop 有序消息投影，按 Run/toolCallId 合并 start/end/history，按正文边界形成 Activity 并保留失败/未知摘要；以事件重放和浏览器测试验证一次调用只占一项、跨 Run 不合并、410 原身份恢复和最终正文不重复（DWUI-ACTIVITY-001、CONV-TOOL-HISTORY-001）。
- [x] 5.4 给消息/Activity 加稳定 key 与显式展开 map，保持阅读锚点与原 pinned 规则；浏览器验证重绘/隐藏 Chat/重连不收起、不抢滚动，长结果截断、旧结果未确认、恶意文本安全呈现、360px 可达（DWUI-ACTIVITY-001、DUL-WORKSPACE-001）。
- [x] 5.5 在 docs/desktop-webui-acceptance.md 记录上述新场景和已有等待/未知回归证据，链接对应 Spec；运行 Desktop typecheck、action-state 与 browser 相关用例，确认生命周期 acceptance/原 ID/未知锁仍成立（DWUI-011、DWUI-014、DWUI-019、DWUI-ACTIVITY-001）。

## 6. Chat Box 设置与 slash 交互

- [x] 6.1 将 Model 与 Thinking 做成 textarea 底部紧凑控件，去掉独立 Save model；接真实能力与完整偏好、default-only 和旧 Agent 模型降级；浏览器验证打开不修改、明确选择才保存、不兼容档位有说明、空/加载/失败/不支持各可辨（DWUI-MODEL-001、DUL-WORKSPACE-001）。
- [x] 6.2 实现 Session 设置 pair 状态机、单在途保存、最新 revision 与 epoch 过滤；用延迟/丢失响应测试验证连续选择串行、跨 Session/身份晚返回、unknown 只读核对、确认前 Send 禁用且草稿保留（DWUI-MODEL-001）。
- [x] 6.3 为无 Session 的 Work 输入保留设置与原创建/提交键，串联明确创建→设置确认→Run 受理；实现原键 GET 恢复；浏览器验证 Send 与 /new 各只创建一次、恢复不自动发送、not-found 保持未知、单槽占用与其他 Session 草稿不变（DWUI-MODEL-001、DWUI-COMMAND-001、CONV-SUBMISSION-001）。
- [x] 6.4 实现安全目录菜单、搜索/分组、命令范围替换及键盘选择；浏览器验证 Enter/Tab 只填入、再次提交才执行、IME/Shift+Enter/Esc、参数保留、空/失败目录、未知命令与字面模式，旧能力缺失时不误触扩展（DWUI-COMMAND-001）。
- [x] 6.5 将 /new、/resume、/model、/thinking、/settings 接到现有网页动作，按发起草稿 snapshot 消费/恢复命令；浏览器验证无模型 Run/命令消息、参数拒绝、取消保留、切换后原草稿不被清除、执行中导航不取消 Run（DWUI-COMMAND-001）。
- [x] 6.6 资源命令明确不附加 Selected service 身份后缀并说明原因，恢复普通输入时保留 toggle；运行真实模板/Skill 参数测试及浏览器用例，确认不读取应用 DOM、不把身份误作参数（DWUI-COMMAND-001、CONV-COMMAND-001）。
- [x] 6.7 更新 docs/desktop-webui.md 的入口与兼容说明及 acceptance 场景映射，产品规则只链接 Spec；运行 Desktop typecheck/browser 相关用例，核验 Model/Thinking/菜单的键盘、错误恢复和 360px 布局（DWUI-MODEL-001、DWUI-COMMAND-001、DUL-WORKSPACE-001）。

## 7. Service 专注、仅 Service 与浏览器全屏

- [x] 7.1 以当前 Services 稳定容器/CSS 实现 Focus、Hide chat、Show chat、Return to workspace，保存选择/焦点/阅读位置；浏览器检测 iframe 节点、文档加载计数、src/origin 和未保存表单，确认布局切换不重载、不复制 Session 或输入框（DUL-002、DWUI-FOCUS-001、BSA-FOCUS-001）。
- [x] 7.2 增加独立 Full screen 动作及 fullscreenchange 状态同步，处理不支持/拒绝/浏览器 Esc/返回退出；受控浏览器与真实 Chrome/Edge 验证用户手势、失败保留 Focus、返回可达，菜单/覆盖层键盘优先级正确（DWUI-FOCUS-001）。
- [x] 7.3 实现小于 900px 的同一 Chat 覆盖层、隐藏时紧凑 Run 状态及正常独立 /app 的仅 Service Focus；浏览器验证 360px 和宽屏、执行/失败/未知不自动弹 Chat，独立视图不创建对话，其他模块导航先退出 Focus（DWUI-FOCUS-001、BSA-FOCUS-001）。
- [x] 7.4 沿原 Service 准入呈现无入口/准备中/禁止嵌入/Preview not confirmed/资格撤销；以访问回归与浏览器测试确认原回退、两秒连接撤销、安全头/origin/授权不变，Full screen 不绕过嵌入（BSA-FOCUS-001、DWUI-FOCUS-001）。
- [x] 7.5 更新 docs/service-access.md 的专注入口与兼容边界、acceptance 的 iframe/全屏证据；运行 Desktop typecheck/browser 相关用例和 Go Service 访问回归，规范引用与实际行为一致（BSA-FOCUS-001、DUL-002）。

## 8. 跨模块集成与交付检查

- [x] 8.1 在隔离环境构建 TS harness、Desktop Go embed 与新 Agent 镜像，执行 Desktop test:real-core 及相关 Go conversation/snapshot history integration；覆盖目录→设置→资源命令→工具合并→Focus，以及新包导出/导入/继续、旧 schema 4 包、旧 Agent 降级，确认没有迁移或历史副作用（本轮全部 CONV、DWUI 与 BSA 需求）。
- [x] 8.2 运行受影响 workspace typecheck/unit/browser、go test -mod=readonly ./... 与 openspec validate improve-desktop-workspace-ux --strict；核对任务完成证据、生成资源及发布/回退边界，记录 docs/desktop-webui-acceptance.md 的跨模块结果；无相关失败不重复扩大测试，不操作用户运行中的 Work（本轮全部需求）。

## 9. SDK 模型能力与真实 Thinking 请求修订

- [x] 9.1 按 design §3 统一内建及已确认 DeepSeek Anthropic-compatible 模型的 SDK 解析，保留 reasoning、thinkingLevelMap 与必要 compat，不再将 SDK 已知能力固定为 false；以 executor/run-models unit 核对支持集合等于当前固定 SDK、Core 候选准入、default-only、未知能力错误及真正非 reasoning Off，不升级 SDK（CONV-MODEL-001、DWUI-MODEL-001）。
- [x] 9.2 对 design §3 的已确认兼容模型落实显式 Off/非 Off 请求映射并保留子 Agent 可序列化能力，执行路径复用同一解析；用受控 HTTP + 真实 SDK fixture 逐档核对请求、SDK 实际值和 Run 快照、Off 无冲突 effort/budget、其他 provider 原生序列化及子 Agent 重载，确认无额外凭据公开或默认绑定改写（CONV-MODEL-001、CONV-RUN-001）。
- [x] 9.3 更新 docs/sdk-adapter.md 的 SDK 来源、兼容解析范围及能力未确认/不支持边界，补充对应受控请求验收证据；运行受影响 Agent/Pi adapter unit 与 Go 模型转发回归，确认接口/版本常量、旧普通接口和完整 pair/未知恢复规则不变（CONV-CHAT-CAPABILITY-001、CONV-MODEL-001）。

## 10. Focus 回退闭环与统一图标

- [x] 10.1 按 design §7 实现单一布局所有者、workspaceReturn/chatReturn 和 Restore layout/Exit focus，分开普通 Chat 模块与 Focus chat；浏览器覆盖四种布局、重复放大、仅 Chat 直接退出、Files 来源与明确切换对象后返回，验证出口持续可见且恢复目标准确（DUL-002、DWUI-FOCUS-001）。
- [x] 10.2 将 Focus、恢复、退出、Chat 显隐及全屏接到现有轻量图标角色与同一稳定容器；浏览器验证与 Open/More 尺寸/状态一致、tooltip/aria/键盘、Focus → Focus chat → Restore layout → Exit focus 的 iframe/祖先身份、加载计数、表单、同一 Session/草稿/阅读锚点/Activity 展开，无新增业务请求（DUL-WORKSPACE-002、DWUI-FOCUS-001、BSA-FOCUS-001）。
- [x] 10.3 完成仅 Chat/窄屏的菜单→全屏→恢复→覆盖层→退出层级和异常出口，保留独立 /app 的仅 Service 规则；浏览器覆盖 360px、全屏拒绝/原生退出、Work/Service 失去资格与跨源键盘无事件，访问回归确认 origin/安全头/撤销边界不变，更新 docs/service-access.md 的入口与返回说明（DWUI-FOCUS-001、BSA-FOCUS-001）。

## 11. Chat 底栏与产品语言

- [x] 11.1 将 Model、Thinking 与 Enter/Send 调整为同一紧凑底栏，复用现有选择器/菜单角色；浏览器实际几何检查宽屏同行等高/垂直居中、360px 长名称换行且发送与错误可达，保持原设置 pair 与发送准入（DUL-WORKSPACE-001、DUL-WORKSPACE-002、DWUI-MODEL-001）。
- [x] 11.2 让 /model、/thinking 与点击打开同一真实选择入口，保留 SDK 档位和保存反馈；浏览器验证打开不写、明确选择才保存、取消/IME/Esc 只作用当前菜单、未知保存只读核对及当前 Run 不变，不以通用档位或 Off 冒充能力（DWUI-MODEL-001、DWUI-COMMAND-001）。
- [x] 11.3 统一 Activity、slash 菜单、设置/执行状态及辅助选项的既有产品文案和视觉，将低频 Service identity 说明收纳到次级入口并保留命令模式原因；浏览器核验必要失败/未知/禁用原因直接可见、技术详情按需、原身份开关/参数及恢复行为不变，更新 docs/desktop-webui.md 和本组 acceptance 场景映射（DUL-WORKSPACE-002、DWUI-ACTIVITY-001、DWUI-COMMAND-001）。

## 12. 补充范围集成与交付核对

- [x] 12.1 在隔离环境同步构建 Desktop Go embed 与新 Agent，串联 SDK 真实能力→设置→实际请求及 Focus 完整往返，验证原 Session/Run 历史和配置不被导航改写；运行受影响 typecheck/unit/browser、Go conversation/模型回归及 OpenSpec strict validate，记录 docs/desktop-webui-acceptance.md 的新证据与已完成任务边界，不把旧 37 项证据代替新场景、不自动重启用户 Work（本次补充 DUL、DWUI、BSA、CONV 需求）。
