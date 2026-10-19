## MODIFIED Requirements

### Requirement: 展示 Core 的真实管理状态

**Identifier:** SUI-CFG-001

状态页 SHALL 显示 Core 是否可达、健康、readiness 原因和公开 checks，提供手动刷新并在页面可见时每 15 秒刷新。初始化缺管理员 SHALL 在统一入口指向受授权的网页首次创建；可选 ADMIN env 不作为默认前置；已登录但运行时缺失 SHALL 链接运行时配置。Core 返回非 ready SHALL 展示 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE` 等实际原因，不能将健康等同于可创建 Work。查询失败 SHALL 标记旧数据及其时间，禁止把旧 ready 显示为当前 ready。

#### Scenario: 健康但未配置运行时
- **WHEN** Core 健康且 readiness 为 RUNTIME_NOT_CONFIGURED
- **THEN** 以英文说明 Core 可达但运行时未配置并提供配置入口，其余可用管理页仍能打开

#### Scenario: 丢失 Core 连接
- **WHEN** 曾显示 ready 的页面刷新失败
- **THEN** 显示当前不可达，旧结果标记为历史状态，恢复后可重新获取

### Requirement: 配置全局运行时并区分保存结果

**Identifier:** SUI-CFG-002

运行时页 SHALL 查看只读 agent image、完整模型安全描述、modelRef、Key 可用性和更新时间。Agent image SHALL 是服务端随当前版本内嵌的发行默认值，不能成为用户填写或选择的参数；首次配置和后续显式保存均由可信服务端取得该引用。引导页、Runtime 管理页及复用的 Console 页面 MUST NOT 提供 Agent 镜像输入框、镜像选择器或高级覆盖。模型连接/Key 在 AI models 直接编辑，不在 Runtime 重复维护。

首次配置和旧 `/runtime` 深链接映射后的 `/admin/runtime` SHALL 具有相同的发行默认行为，不因绕过引导而要求手填。保存端 SHALL 使用并核对服务端发行引用；复用旧 DTO 所需的 agentImage 字段只能由受信适配层自动提供，不接受浏览器自定义的不同引用。缺少或无法验证内置引用 SHALL 报告发行配置错误并提供只读核对方向，不展示手填镜像作为恢复方式。读取已有配置 SHALL 如实显示其已保存镜像，仅启动或读配置不自动改写；用户显式保存时使用当前发行默认，已有 Work 不被隐式 Update/Apply。

Choose model SHALL 列出已保存、启用且凭据可用的模型，包括自定义 ID；不以 SDK 目录、模板、Thinking 或 Test 结果过滤。停用、无 Key 或真实环境不兼容必须说明原因和恢复方向，不静默消失。空目录提供 Add model 入口；所有项不可用时展示相应原因，不能误称没有模型。已有选择不可用保留描述，不自动替换。

保存成功 SHALL 以 Core persisted 配置为准。已保存但环境未 ready 用英文分别说明两个事实及真实状态；校验/保存前失败保留旧配置与非敏感草稿，不自动重复提交。变更只更新后续新 Work 默认，不暗示旧 Work 已切换。旧深链接 SHALL 映射到统一管理区，既有持久初始化模型对应关系保留，不要求重新输入 Key；不再从 env 初始化或更新模型。

#### Scenario: 首次选择自定义模型
- **WHEN** 用户在 AI models 添加 SDK 未收录的模型，回到 Runtime
- **THEN** Choose model 可直接选择，服务端自动使用同版发行 Agent image 保存/准备运行时，页面不出现镜像输入或高级覆盖，不需要其他配置步骤

#### Scenario: 首次配置
- **WHEN** 管理员选择已保存的完整模型并保存，无须提供 Agent image
- **THEN** 显示已保存配置、Key 可用性及真实 readiness，不重复填写 Key、不要求 Provider 或模板

#### Scenario: 从管理页或旧深链接首次配置
- **WHEN** 安装已有可用模型但尚无 runtime，管理员打开 `/admin/runtime` 或旧 `/runtime` 链接
- **THEN** 可直接选择模型并保存，保存结果的 Agent 引用与服务端同版发行元数据一致，不存在必填镜像框、镜像选择器或高级镜像覆盖

#### Scenario: Agent 引用不能由浏览器覆盖
- **WHEN** 浏览器保存 runtime 时省略 Agent 镜像输入，或试图提交与服务端发行引用不同的值
- **THEN** 正常保存使用服务端内置引用，不同值不能改变生效镜像；无效或缺失的发行信息显示安全错误，不改为要求用户手填

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

### Requirement: 按编辑字段更新默认 Work

**Identifier:** SUI-CFG-003

默认 Work 页 SHALL 查看完整公开 configuration，并为 Skills、packages、AGENTS 内容提供编辑。base image SHALL 只读展示已保存的 Agent 镜像，其发行默认行为遵守 SUI-CFG-002，不提供镜像输入框、选择器或高级覆盖；网页保存端 MUST 拒绝通过 baseImage 修改镜像。其他公开字段可以只读展示。Skills SHALL 按名称从启用项中选择并保持用户顺序，支持调整顺序及显式清空；packages SHALL 从启用 Core catalog 中多选、最多 64 个、可显式清空。当前选择若已不可用 SHALL 显示其名称和无效原因，不静默丢弃。Default Skills 没有选择时 SHALL 明确显示空状态，不能仅显示排序标题；选中项 SHALL 在本行提供可读取或可复制的完整名称、选中顺序及其可用状态。名称过长时 SHALL 在本行换行或提供紧邻的完整名称访问方式，不因溢出遮挡排序、移除或保存。重复的排序动作 SHALL 使用简短可见标签，并以包含完整 Skill 名称及方向的无障碍名称区分目标；不可用项的原因 SHALL 紧邻该项，且在用户处理前继续保留在草稿中。

保存 SHALL 只提交相对加载基线实际编辑的字段；服务端原子合并，未编辑字段及并发的无关修改 SHALL 保留，不提交 revision。请求内任一字段无效 SHALL 整体拒绝。无更改时保存禁用；成功后用返回结果重置基线。未初始化默认配置时 SHALL 引导先配置运行时并禁用保存，不猜测一份配置。页面 SHALL 说明修改只影响后续新 Work，不触发已有 Work apply。

#### Scenario: 仅修改默认 packages
- **WHEN** 管理员编辑 packages，另一管理员同时修改 AGENTS 或模型
- **THEN** 请求只含 packages，成功结果保留对方变更，Skills 等未编辑字段保持不变

#### Scenario: 清空某一默认选择
- **WHEN** 管理员显式清空 Skills 或 packages 并保存
- **THEN** 对应字段提交空数组，其他默认值保留，不禁用或移除 catalog 条目

#### Scenario: 选择在提交前被禁用
- **WHEN** 保存的某个 Skill 或 package 在 Core 已不可用
- **THEN** 显示字段错误并保留草稿，不保存部分默认配置

#### Scenario: 默认 Skills 为空
- **WHEN** 默认 Work 未选择任何 Skill
- **THEN** 页面明确显示没有选中项及选择入口；排序动作不出现，保存按钮仍按实际草稿变化决定是否可用

#### Scenario: 长名称与重复排序动作
- **WHEN** 多个已选 Skill 的名称较长或相近，且管理员要改变顺序
- **THEN** 每行均可读取或复制完整名称并辨认顺序；可见排序按钮保持简短，无障碍名称准确包含该行完整名称和移动方向，360px 宽屏下不遮挡其他行操作

#### Scenario: 已选 Skill 不再可用
- **WHEN** 默认配置中的已选 Skill 被禁用或移除
- **THEN** 页面在对应项旁说明不可用及原因，仍保留其完整名称与顺序供管理员处理，不静默丢弃该项，也不将不可用状态误作保存成功

#### Scenario: 默认镜像只读且不可通过网页覆盖
- **WHEN** 管理员打开默认 Work 页面，或浏览器试图提交 baseImage 修改
- **THEN** 页面只读展示已保存镜像，覆盖请求被拒绝且持久配置保持；Skills、packages 和 AGENTS.md 仍按各自编辑与保存规则工作
