# Spec Delta

## Purpose

让用户通过 Pi 对话按需选择或刷新当前 Work 的指定 Service，将 Agent 的展示意图作用于发起请求的工作台页面。以尽力执行方式完成视图操作，明确多 Service 定位、原页面隔离、重复事件与失效请求边界，保持既有应用访问和对话执行契约。

## ADDED Requirements

### Requirement: Agent 可按需调用独立的 Service 视图工具

**Identifier:** ASVC-001

支持此能力的 agentd SHALL 在真实 Pi SDK 中提供 `service_select` 和 `service_refresh` 两个独立工具，按当前 Work 的 allowed/denied 策略过滤，denied 优先。工具 SHALL 接受目标 `serviceId` 及可选声明 Web 端口，不接受调用者指定 Work、任意 URL 或运行身份。Agent SHALL 获得简短使用指导，按用户任务需要调用；能力不依赖启用 piwork-brain，不因普通查询、部署或每次 Run 完成而强制触发。

#### Scenario: 根据用户任务选择工具
- **WHEN** 用户要求展示 Service B，随后要求刷新正在查看的 B
- **THEN** 实际 SDK 可以分别调用 Select 和 Refresh，指导说明两者独立及展示请求的尽力执行语义

#### Scenario: 工具被策略禁止
- **WHEN** active 策略禁止 `service_refresh`，或非空 allowed 未包含该工具
- **THEN** SDK 不暴露该工具，其他工具不能借同名结果获得被禁止的视图操作能力

#### Scenario: 未启用脑包
- **WHEN** Work 未启用 piwork-brain，但 active 工具策略允许视图工具
- **THEN** Agent 仍可发现和调用这两个工具，既有 Service 管理权限不被隐式授予

### Requirement: 视图请求采用尽力执行结果

**Identifier:** ASVC-002

合法工具调用 SHALL 返回可识别的“已生成视图请求”结果，不等待浏览器回执，不把结果表述为页面已经选中、加载成功或刷新完成。无可用接收页面、目标未展示或浏览器执行失败 SHALL 不引入等待、补发、持久待执行队列或模型自动重试。参数非法或 Run 已取消时 SHALL 不生成有效指令。同一 Run 连续生成 Select 请求时，仍按尽力执行语义处理，不承诺最后一次请求必定生效。

#### Scenario: 原页面已关闭
- **WHEN** Agent 调用工具时发起页面已经关闭
- **THEN** 工具仍只报告请求已生成，不等待回执，其他页面不接管，之后重新打开也不执行旧请求

#### Scenario: 工具结果不是应用验证
- **WHEN** Agent 收到视图请求的正常结果
- **THEN** 该结果不证明浏览器执行或业务就绪，不能替代实际 Service 状态和业务验证

#### Scenario: 参数非法或调用已取消
- **WHEN** 输入缺少目标、端口非法、包含额外控制目标，或执行上下文已取消
- **THEN** 工具拒绝该调用，不产生可执行视图请求

### Requirement: 多 Service 操作精确绑定目标

**Identifier:** ASVC-003

浏览器 SHALL 按所属 Work 的准确 Service ID 解析指令，不用列表位置、相似名称或当前选中项替代请求目标。显式端口 SHALL 属于该 Service 声明的 Web 端口；省略端口时，同一已选 Service 沿用当前合法端口，其他目标沿用现有选择器的默认端口规则。不存在、已移除、无 Web 端口或显式端口不合法的目标 SHALL 被忽略，不操作其他 Service。

#### Scenario: 多个 Service 中选择 B
- **WHEN** Work 有 A、B、C，Agent 指定 B 的 Service ID
- **THEN** 只定位 B，不因列表排序或名称相似而选择 A 或 C

#### Scenario: 保留同一 Service 的当前端口
- **WHEN** B 有多个声明 Web 端口，当前选中其中一个，工具省略端口
- **THEN** 使用 B 的当前合法端口；选择另一 Service 时使用现有选择器的默认端口

#### Scenario: 拒绝错误目标和端口
- **WHEN** 指令指定另一 Work 的 Service ID、Removed 对象或未声明端口
- **THEN** 不打开或刷新任何替代对象，也不访问任意地址

### Requirement: Select 展示目标且不隐式刷新

**Identifier:** ASVC-004

Select SHALL 在原页面的普通 Services 区域选中并展示合法目标，不进入 Focus 或浏览器全屏，不新建标签页或 Session。目标已经展示且端口相同时 SHALL 保留同一应用文档，不附带刷新。目标暂不可用时 SHALL 复用既有状态说明和入口规则，不自动启动、启用、重启或等待其生命周期完成。Chat 会话、草稿和 Run 观察 SHALL 保留；既有未保存文件或配置的导航保护不得被绕过。

#### Scenario: 从 Chat 展示指定应用
- **WHEN** 原页面正在查看普通 Chat，收到当前 Work 的 Select B
- **THEN** 页面进入普通 Services 区域并选中 B，保持同一 Chat，不进入专注或全屏布局

#### Scenario: 重复选中同一目标
- **WHEN** B 及其目标端口已经展示，再次收到 Select B
- **THEN** 原 iframe 文档不重载，应用内输入保持

#### Scenario: 选择尚未就绪的 Service
- **WHEN** 合法 Web Service B 被禁用、正在启动或失败
- **THEN** B 被选中并显示既有真实原因，不提交 Start、Restart 或其他生命周期操作

#### Scenario: 页面有受保护草稿
- **WHEN** Select 需要离开存在未保存文件或配置的区域
- **THEN** 沿现有导航保护处理；未获准离开时不切换、不丢弃草稿，也不额外保存待执行视图请求

### Requirement: Refresh 仅直接重载已展示的目标应用

**Identifier:** ASVC-005

Refresh SHALL 仅在原页面实际展示请求 Service 及解析后的端口、且入口仍获准时直接重载该应用页面，不弹新增确认框，不切换 Service，不重载整个工作台。目标未选中、当前模块未展示应用或 iframe 不存在时 SHALL 忽略。刷新可能丢失应用内未保存内容，不承诺保留应用内部路由和滚动位置；Chat 草稿、Session、Activity 与 Run 观察 SHALL 保留。

#### Scenario: 直接刷新正在展示的 B
- **WHEN** B 的目标端口正在展示且仍有访问资格，Agent 请求 Refresh B
- **THEN** B 应用文档重新加载，无新增确认框；工作台和 Chat 不重载，Service 进程不被重启

#### Scenario: 正在展示 A 时刷新 B
- **WHEN** 当前展示 A，收到 Refresh B
- **THEN** 不切换到 B、不重载 A，也不保留等待以后选中 B 再执行的请求

#### Scenario: Service 选中但应用未展示
- **WHEN** B 是记住的选中项，但用户当前在 Files 或 Chat，或 B 没有挂载的预览
- **THEN** Refresh B 被忽略，当前区域与草稿不改变

### Requirement: 只有原发起页面可执行本轮视图请求

**Identifier:** ASVC-006

浏览器 SHALL 仅为本页面实例实际发起并确认受理的 Run 执行视图请求，匹配当前身份及 Work、Session、Run 身份。其他浏览器、同一浏览器另一标签、CLI 发起的 Run 或自动 Service Run 不获得本页执行资格。资格只保存在页面内存；页面重载、关闭、身份变化或离开所属 Work 后 SHALL 失效，返回或重连不能从历史恢复资格。

#### Scenario: 同一 Work 同时在电脑和手机打开
- **WHEN** 电脑页面发起 Run，两个页面都观察到它的 Select B 工具结果
- **THEN** 只有电脑的原发起页面可以选中 B，手机的 Service 选择和应用文档不改变

#### Scenario: 原页面失效后返回
- **WHEN** 请求期间原页面重载，或用户离开该 Work 后返回
- **THEN** 旧 Run 的视图执行资格不恢复，历史中仍可阅读工具结果但不执行旧操作

#### Scenario: 来源没有浏览器发起页面
- **WHEN** Run 由 CLI 或 Service 自动请求产生，浏览器只是观察者
- **THEN** 浏览器不根据该 Run 的工具结果切换或刷新 Service

### Requirement: 指令消费只接受真实有序工具结果且不重复执行

**Identifier:** ASVC-007

浏览器 SHALL 只从原 Run 的有效工具完成事件识别约定工具及版本化指令，验证结果完整、非错误、未截断、动作和工具名一致。指令 SHALL 按真实 Run、工具调用 ID 和事件身份去重，每次调用最多尝试一次；忽略的请求也不得因状态后来变化再执行。普通 Assistant 文本、其他工具结果、历史页和最终回复不能触发视图操作。异步准备完成后 SHALL 再次核对原页面、目标和当前访问资格。

#### Scenario: 工具开始及连接重复事件
- **WHEN** 收到工具开始事件、工具完成事件及其重复交付
- **THEN** 只有合法完成事件触发至多一次尝试，不因重复开始或重新连接再次刷新

#### Scenario: 伪指令或不完整结果
- **WHEN** Assistant 或其他工具输出相同 JSON，或结果版本未知、截断、错误、目标格式非法
- **THEN** 只按普通内容显示或忽略，不执行选择或刷新

#### Scenario: 入口准备期间页面改变
- **WHEN** Select 正在读取 Service 列表或准备入口，用户离开原 Work 或明确选择了另一目标
- **THEN** 旧异步结果不覆盖新选择，不挂载或刷新旧目标，不补发

### Requirement: 能力采用保持现有运行与访问兼容

**Identifier:** ASVC-008

此能力 SHALL 沿既有 Agent 镜像选择与 Apply 边界采用，不自动升级固定 Work。旧 Agent 缺少工具时保留基础对话；旧 UI 可以把新工具结果作为普通 Activity 显示而不执行。浏览器 SHALL 沿既有 Service 入口及嵌入授权访问目标，不绕过停止、移除、身份撤销或嵌入拒绝，不自动打开外部窗口。视图请求不改变 Run 幂等身份、历史格式和 Service MCP 生命周期权限。

#### Scenario: 新旧组件分别升级
- **WHEN** 新 UI 连接旧 Agent，或旧 UI 观察新 Agent 的视图工具结果
- **THEN** 基础 Chat 和 Service 管理保持，缺失工具或未执行视图操作不被描述为成功，也不触发隐式升级

#### Scenario: 应用不能嵌入或已失去资格
- **WHEN** 目标 Service 拒绝嵌入、已停止、已移除或身份已经失效
- **THEN** 保持既有状态、拒绝和手动回退入口，不强制显示、刷新或自动打开新窗口
