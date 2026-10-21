# Spec Delta

> 对应 M03 管理体验，复用既有配置与持久事实；只调整主动作与维护呈现。

## MODIFIED Requirements

### Requirement: 展示 Core 的真实管理状态

**Identifier:** SUI-CFG-001

状态页 SHALL 显示 Core 是否可达、健康、readiness 原因和公开 checks，提供手动刷新并在页面可见时每 15 秒刷新。初始化缺管理员 SHALL 在统一入口指向普通网页首次创建；可选 ADMIN env 不作为默认前置；已登录但运行时缺失 SHALL 链接运行时配置。Core 返回非 ready SHALL 展示 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE` 等实际原因，不能将健康等同于可创建 Work。查询失败 SHALL 标记旧数据及其时间，禁止把旧 ready 显示为当前 ready。

Overview SHALL 按当前可确认事实提供一个主要任务动作：缺模型/Runtime时继续设置；已配置但正在准备时查看原准备；当前状态确认Ready时打开工作台。准备失败/未知提供诊断或恢复而不冒充进行中。Quick setup SHALL 保持单一可发现入口，不在已完成安装的状态卡与任务列表重复成为主动作。管理任务按现有User access、Work setup及辅助运维职责组织，配置与诊断仍可达，不改变顶层导航和旧深链接。准备页六项完成契约不得扩大为整个工作台的登录或访问门禁。

#### Scenario: 健康但未配置运行时
- **WHEN** Core 健康且 readiness 为 RUNTIME_NOT_CONFIGURED
- **THEN** 以英文说明 Core 可达但运行时未配置并提供配置入口，其余可用管理页仍能打开

#### Scenario: 丢失 Core 连接
- **WHEN** 曾显示 ready 的页面刷新失败
- **THEN** 显示当前不可达，旧结果标记为历史状态，恢复后可重新获取

#### Scenario: Ready安装进入日常使用
- **WHEN** 已有安装的当前状态确认Ready，管理员打开Overview
- **THEN** 主要动作是Open workbench，Quick setup作为单一后续配置入口可发现；原配置与诊断仍可达，不重复要求完成首次设置

#### Scenario: 准备中或读取失败的主要方向
- **WHEN** 配置已保存但依赖尚在准备，或已有Ready摘要后新状态读取失败
- **THEN** 前者主要方向是查看当前准备，后者显示最后确认及恢复而不宣称当前Ready；不增加工作台全局访问门禁

### Requirement: 配置全局运行时并区分保存结果

**Identifier:** SUI-CFG-002

运行时页 SHALL 查看完整模型安全描述、modelRef、Key 可用性和更新时间。Agent image SHALL 是服务端随当前版本内嵌的发行固定值，不能成为用户填写或选择的参数；首次配置和后续显式保存均由 Core 取得该引用。CoreSetup、Runtime 管理及复用 Console MUST NOT 提供 Agent 镜像输入框、选择器或高级覆盖，配置表单和默认摘要不常驻发行/已保存镜像长地址或对比；必要镜像信息 SHALL 收入按需只读诊断并可完整读取/复制。模型连接/Key 在 AI models 编辑，不在 Runtime 重复维护。

首次配置和旧 `/runtime` 深链接映射后的 `/admin/runtime` SHALL 具有相同的发行默认行为，不因绕过引导而要求手填。保存请求只选择模型，Core 统一解析并核对发行引用；兼容旧 HTTP 镜像字段时仅允许与 Core 内嵌引用相同，不接受自定义不同值。缺少或无法验证内置引用 SHALL 报告发行配置错误并提供只读核对方向，不展示手填镜像作为恢复方式，也不把模型保存事实改为失败。读取已有配置 SHALL 如实保留其已保存镜像，仅启动或读配置不自动改写；用户显式保存时使用当前发行固定值，已有 Work 不被隐式 Update/Apply。

Choose model SHALL 列出已保存、启用且凭据可用的模型，包括自定义 ID；不以 SDK 目录、模板、Thinking 或 Test 结果过滤。停用、无 Key 或真实环境不兼容必须说明原因和恢复方向，不静默消失。空目录提供 Add model 入口；所有项不可用时展示相应原因，不能误称没有模型。已有选择不可用保留描述，不自动替换。进入模型管理再返回 SHALL 保留已确认模型与合法非敏感草稿，存在未保存编辑时先处理；引导和管理的模型字段、校验、Test 与敏感清理使用相同语义。

保存成功 SHALL 以 Core persisted 配置为准。已保存但环境未 ready 用英文分别说明两个事实及真实状态；校验/保存前失败保留旧配置与非敏感草稿，不自动重复提交。变更只更新后续新 Work 默认，不暗示旧 Work 已切换。旧深链接 SHALL 映射到统一管理区，既有持久初始化模型对应关系保留，不要求重新输入 Key；不再从 env 初始化或更新模型。CoreSetup 的统一继续动作按 ONBOARD-002 推进，Admin 保留正常编辑/保存和 readiness 检查，不要求用户重复完成首次引导。

统一应用 SHALL 从 Overview 提供 Admin 内的 Quick setup，路径和身份边界遵守 ONBOARD-002/004。Quick setup、完整 Runtime 与 AI models 管理 SHALL 读取同一持久模型和 Runtime，采用相同校验、显式 Test、敏感清理及未知结果读回规则，不因快速入口另建配置、强制 Test 或重新要求已有 Key。已配置安装可通过快速入口显式选模型并保存；原 `/admin/runtime` 与 `/admin/models` 及其旧深链接 SHALL 保留。高级独立 Console 保持现有管理能力，不依赖统一应用专用的首次创建流程。

已配置Runtime页面 SHALL 以当前模型安全摘要、配置影响范围、编辑与维护状态组织内容，不常驻 Make this Core ready 或 Configure runtime / Confirm readiness 首次部署轨道。模型名称/ID、协议、地址摘要、Key是否可用、modelRef和更新时间 SHALL 可读取；长技术身份按需披露，不回显Key。Edit runtime、显式状态检查、只读诊断及返回工作台/管理导航 SHALL 保留；未配置安装仍提供真实下一步，不删减 Default Work 的Skills、Packages和AGENTS能力。保存和读取采用统一局部三点与连续性规则，不混淆保存确认与Ready。

#### Scenario: 首次选择自定义模型
- **WHEN** 用户在 AI models 添加 SDK 未收录的模型，回到 Runtime
- **THEN** Choose model 可直接选择，服务端自动使用同版发行 Agent image 保存/准备运行时，页面不出现镜像配置或高级覆盖，不需要其他配置步骤

#### Scenario: 首次配置
- **WHEN** 管理员选择已保存的完整模型并保存，无须提供 Agent image
- **THEN** 显示已保存配置、Key 可用性及真实 readiness，不重复填写 Key、不要求 Provider 或模板

#### Scenario: 从管理页或旧深链接首次配置
- **WHEN** 安装已有可用模型但尚无 runtime，管理员打开 `/admin/runtime` 或旧 `/runtime` 链接
- **THEN** 可直接选择模型并保存，保存结果的 Agent 引用与服务端同版发行元数据一致，不存在必填镜像框、选择器或高级覆盖

#### Scenario: Agent 引用不能由浏览器覆盖
- **WHEN** 浏览器保存 runtime 时省略 Agent 镜像输入，或试图提交与服务端发行引用不同的值
- **THEN** 正常保存使用服务端内嵌引用，不同值被拒绝且不能改变生效镜像；无效或缺失的发行信息显示安全错误，不改为要求用户手填

#### Scenario: Docker 暂时不可用
- **WHEN** Core 已保存配置但环境检查失败
- **THEN** 显示已保存与未 ready 两种事实，刷新仍看到新值，允许稍后检查

#### Scenario: 真实不可用项
- **WHEN** 目录有停用/无 Key 模型，或旧镜像实际不支持所选执行
- **THEN** 显示该项及具体原因/升级方向，保留选择和草稿，不用 SDK 名称未知冒充不可用

#### Scenario: 缺少 credential 或提交失败
- **WHEN** 模型凭据不可用、没有有效选择，或保存 API 返回结构/字段校验错误
- **THEN** 明确说明 Key/模型条件或具体字段，保留原配置与非敏感草稿，不声称成功或自动选择另一模型

#### Scenario: 保留已有入口配置
- **WHEN** 打开旧初始化或 Provider 迁移得到的模型
- **THEN** 完整模型及引用可见、Key 可用性保留，无 Provider 管理或重填秘密步骤

#### Scenario: 镜像只在诊断中按需查看
- **WHEN** 管理员打开或编辑 Runtime，再展开技术诊断
- **THEN** 默认内容突出模型、保存和 readiness，展开后才查看完整已保存/发行镜像身份；诊断无修改入口，读取不改写已有配置

#### Scenario: 快速与完整配置共用事实
- **WHEN** 管理员在 Quick setup 保存后进入 Runtime/AI models，或在完整管理页修改后返回 Quick setup
- **THEN** 读取同一已确认模型与 Runtime，不创建第二套配置、不重复索要 Key；准备结果独立呈现，未保存内容先处理，已有 Work 不被改写

#### Scenario: 已配置Runtime用于维护
- **WHEN** 管理员在已配置且Ready的安装打开Runtime
- **THEN** 看到当前配置、作用范围和维护动作，而非要求重新完成部署的步骤轨道；可编辑模型引用/读状态，既有Work仍保留原配置

#### Scenario: 待完成步骤不冒充成功
- **WHEN** Overview 仍缺 Runtime 或等待 readiness 确认
- **THEN** SHALL 将未完成项表述为 Save runtime 或 Confirm readiness，不在该项未确认时显示 Runtime saved 或 Readiness confirmed
