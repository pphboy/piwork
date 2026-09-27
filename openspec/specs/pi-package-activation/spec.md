# Pi Package Activation Specification

## Purpose

定义 Work 所拥有 Pi package 如何经显式配置激活进入真实 agent SDK，包括资源和工具的隔离、headless 事件、加载失败与当前状态，防止仅安装文件却没有可验证运行效果。

## Requirements

### Requirement: Load only the captured enabled package resources

**Identifier:** PKGA-001

agent SHALL 只加载当前已验证 active context 的 enabled package；create/apply candidate 初始化 SHALL 只加载其捕获 context 且关闭对话路由。系统 SHALL 使用真实 Pi SDK 的 package manifest 与约定目录发现 extensions、Skills、prompt templates 和 themes；不得读取 Core current catalog、宿主/global/project 自动发现、其他 Work、pending desired 或网络来源。不启用的包 SHALL 不执行 extension 工厂且不注册资源。

必需资源缺失、摘要不符、不可读取、SDK 加载错误或返回路径不属于允许 context SHALL 阻止 ready/activation，报告包名及 `PI_PACKAGE_LOAD_FAILED`。安装成功 SHALL 与 SDK 加载验证分开。运行时 SHALL 不通过下载、安装或构建修复错误。

#### Scenario: A valid package extends the agent
- **WHEN** enabled 包提供可加载 extension、Skill、prompt 和 theme
- **THEN** 真实 SDK 发现对应资源，headless Run 可使用其 Skill/prompt/tool，readiness 报告实际加载结果

#### Scenario: A disabled package contains an invalid extension
- **WHEN** context 中该包 enabled=false
- **THEN** 不执行其工厂、不注册其资源，它的运行错误不被当成当前 enabled 加载失败

#### Scenario: Reject implicit discovery
- **WHEN** workspace 或 HOME 存在未配置 extension/Skill/settings，或 dynamic resource 返回越界路径
- **THEN** 未配置内容不进入 SDK，显式越界资源使相关加载/Run 失败而不静默添加

#### Scenario: Required extension fails during initialization
- **WHEN** 候选 enabled extension 无法导入或注册失败
- **THEN** candidate 不 ready，Operation 保留安全包诊断，原 active 不被替换

### Requirement: Apply package changes at the established configuration boundary

**Identifier:** PKGA-002

Work package 安装、更新、enable、disable、remove SHALL 沿用 WCFG-002 的 desired→显式 apply→active 时机，不引入第二套生效机制。普通 restart SHALL 加载已有 active。apply SHALL 是可重试的持久 Operation，候选成功加载和 readiness 验证后才改变 active；失败保留旧 active 并按原运行意图恢复 runtime。运行中的 Run SHALL 不被 apply 取消，返回 WORK_BUSY。stopped Work SHALL 初始化验证后确认停止再提交 active，不能把 install 成功当作验证成功。

#### Scenario: Update then restart without apply
- **WHEN** active=v1、desired=v2，用户仅 stop/start
- **THEN** runtime 仍加载 v1，v2 保持 pendingApply

#### Scenario: Explicit apply activates the package
- **WHEN** 用户对 pending v2 执行 apply 且完整验证成功
- **THEN** active 变为捕获的 v2，只有没有后续 desired 编辑时 pendingApply=false

#### Scenario: Roll back a broken candidate
- **WHEN** v2 加载失败而 v1 是原 active
- **THEN** active 保持 v1，desired 保留 v2 和失败诊断；需要恢复 runtime 时使用 v1，恢复失败明确报告 Work failed

#### Scenario: Apply a stopped Work
- **WHEN** stopped Work 的新包 candidate 需要验证
- **THEN** 验证期间不接受 Run，确认停止后 active 才提交，最终 runtime 状态 unavailable

### Requirement: Reject ambiguous resources and enforce package tool policy

**Identifier:** PKGA-003

enabled 包之间及与独立 Skills 的同名 Skill、包间同名 prompt/theme/extension command、以及与 builtin/MCP/其他包重复的原生 tool name SHALL 返回 `PI_PACKAGE_RESOURCE_CONFLICT`，不得覆盖或按发现顺序择一。disabled 包不参与运行冲突。

package 工具策略名 SHALL 为 `package:<package-name>:<native-tool-name>`，native-tool-name 匹配 `[A-Za-z0-9_-]{1,64}`，策略键最多 512 字符。allowed 空表示不额外收窄、denied 优先，沿用既有工具规则；ready 报告最终 canonical 工具集合。被拒绝工具 SHALL 不进入模型可调用集合。此策略 SHALL 不被描述为限制任意 extension JS 的文件/网络代码沙箱；代码仍受 Work 容器边界约束。

#### Scenario: A package conflicts with a standalone Skill
- **WHEN** enabled 包内 Skill 与显式独立 Skill 同名
- **THEN** apply 失败并指出资源类型/安全名称，不能静默覆盖任一 Skill

#### Scenario: A denied package tool is registered
- **WHEN** 包注册 hello，配置 denied 包含 package:@example/pi-tools:hello
- **THEN** SDK 工厂可完成加载，但模型工具列表与 resolvedTools 不包含该工具，模型调用不能绕过策略

#### Scenario: Two packages register the same native tool
- **WHEN** 两个 enabled 包都注册 hello，即使它们有不同 package name
- **THEN** activation 明确资源冲突，不能因 canonical 前缀不同而静默混用 SDK 注册

### Requirement: Bind headless extension events to isolated SDK sessions

**Identifier:** PKGA-004

每个新建或恢复的 SDK session SHALL 绑定其 Work context 的独立 resource/extension runtime，以 headless JSON 模式运行 session_start、resources_discover 和 SDK 支持的 Run/tool 事件。一次 Run 使用的 SDK session 清理时 SHALL 发送 session_shutdown 后释放资源；失败/中止也 SHALL 清理，不承诺进程被强杀时执行 hook。不承诺跨 Run 常驻 extension JS 状态，不允许跨 Work/Session 共享可变 extension runtime。

readiness SHALL 验证加载/注册，不创建持久用户 Session 或调用模型。Run SHALL 收集 SDK extension runner 报告但未直接抛出的 handler 错误：session_start/resources_discover 失败 SHALL 在 prompt 前使 Run 失败；Run/tool 事件处理失败 SHALL 使该 Run 以安全诊断失败，不得只向控制台输出错误并返回成功。失败或中止仍 SHALL 发送 session_shutdown 并释放 listener/session；shutdown 自身错误只作为清理诊断，不得改写已经持久化的 Run 终态。主题 SHALL 保留并被发现但不提供 TUI；TUI 交互沿用 SDK headless 限制。既有 Session 的 context 绑定 SHALL 保留，apply 后旧 context Session 不得静默执行新包。

#### Scenario: Execute a real registered tool and events
- **WHEN** 一个合法 Run 使用包的 hello 工具
- **THEN** 真实 SDK 执行其实现，事件可观察到对应 session/agent/tool 生命周期且清理只作用于该 SDK 实例

#### Scenario: Isolate two SDK sessions
- **WHEN** 两个 Work 或两个 Session 使用同包且 extension 有内存计数器
- **THEN** 它们不会共享计数器/handler/注册表，一次 dispose 不移除另一实例的 handler

#### Scenario: A session start hook fails
- **WHEN** extension 工厂已通过 readiness，但某次 session_start 在 Run 初始化失败
- **THEN** prompt 不执行，该 Run 返回安全错误并清理 SDK session，不把一次 readiness 成功承诺为后续 hook 永不失败

#### Scenario: A runtime event hook fails
- **WHEN** extension 的 agent/tool 事件 handler 在 prompt 期间抛错，SDK 将该错误报告给 extension runner 而非直接抛给调用者
- **THEN** Run 最终状态为失败，返回安全诊断，不能因模型仍产生文本而报告成功；session_shutdown 与 listener/session 清理仍执行

#### Scenario: Shutdown hook fails after a terminal result
- **WHEN** Run 已持久化终态，随后 session_shutdown handler 报错
- **THEN** 错误只记录为安全清理诊断，不改写终态，listener 与 SDK session 仍被释放

### Requirement: Verify actual package readiness before routing

**Identifier:** PKGA-005

Core SHALL 对每次 create/start/restart/apply/rollback/recovery 验证 package contract、实际 loaded package 成员和制品身份、资源来源及最终工具策略。报告 SHALL 与该 Operation 的 enabled context 完全一致；额外、缺失、重复、错误内容或过时代次不得 ready。缺少 package contract SHALL 返回 AGENT_CONTEXT_INCOMPATIBLE；成员或内容不符 SHALL 返回 AGENT_CONTEXT_MISMATCH。公开状态 SHALL 遵循 PKG-008，不暴露内部身份。

#### Scenario: Same name and version but wrong bytes
- **WHEN** agent 报告的包名/version 正确但所加载制品与捕获内容不同
- **THEN** Core 拒绝路由/activation，记录 context mismatch

#### Scenario: Adopt a container after Core restart
- **WHEN** Core 发现已有匹配标签容器
- **THEN** 必须重新验证当前 package handshake，不能仅凭标签或缓存 loaded 状态采用它

#### Scenario: Old agent omits package support
- **WHEN** agent 未报告必需的 package contract，即使 Work packages=[]
- **THEN** Core 明确拒绝旧 agent，提示使用兼容运行镜像，不把缺字段当成空包支持
