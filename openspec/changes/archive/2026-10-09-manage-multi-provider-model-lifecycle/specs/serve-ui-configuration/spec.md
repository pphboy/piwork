## ADDED Requirements

### Requirement: 在 Serve UI 直接管理模型

**Identifier:** SUI-MODEL-001

Serve UI SHALL 提供 AI models 可发现导航、平铺模型列表及新增/编辑模型表单。主流程为“添加模型 → Test（可选）→ 保存 → Choose model”，不出现 Provider 创建/详情/分组或能力模板/Capabilities JSON 配置步骤。

新增表单 SHALL 只要求 Model ID、API type（Responses/Messages）、Base URL、API Key；显示名称可选，留空使用 Model ID。新模型 Model ID 与显示名称的输入上限均为 256 个字符，与创建、编辑及读取契约一致；长名称可编辑，不因旧 Provider 的 128 字符限制被截断或误拒绝。模型保存成功直接成为完整条目，不需要再添加子模型。Key 编辑不回填，留空保留；其他字段预填。每条模型独立管理连接、启停、Key 和删除依赖。

Messages 根地址与末尾 /v1 写法均可直接 Test/保存，提示随协议一致；普通地址表示不被当作错误。模型显示已保存、启停和 Key 可用性，SDK 未收录/Thinking 未确认不应显示为模型未配置或要求补模板。

Test SHALL 在模型表单直接检查草稿，名称不是必填项；Modal 展示目标、测试消息、进行中、实际回复或安全原因/恢复、HTTP 状态（如有）、时间/耗时及截断/过期。页面保留摘要和查看入口，查看不外发。关闭、导航、身份失效及晚到结果的隔离、焦点恢复、纯文本转义和窄屏滚动沿用既有 dialog 约定。

本地校验说明字段及修改方向，明确请求未外发；实际请求失败与结果未确认分别表达，不只显示通用错误/category。返回表单可定位字段，修正或新检查清除已不适用错误。保留非敏感草稿，Key 不进入持久存储；供应商认证失败不注销管理员，真正会话失效才清理敏感内存并引导登录。Test 失败不禁用保存/启用，未知写入仍先读回，不自动重提。

Read current data 与 Configure runtime SHALL 仍位于统一标题栏操作区；模型详情使用 All models 返回导航。移除旧 All providers/Provider connection 操作。加载、空列表、失败和真实不可用状态分开，360px 可访问完整目标、操作与恢复入口。

#### Scenario: 一个表单完成添加
- **WHEN** 管理员填写四项连接字段、可选 Test 后保存
- **THEN** 新模型出现在平铺列表，无 Provider、子模型或能力 JSON 步骤，随后可进入 Runtime 选择

#### Scenario: 自定义 ID 不被隐藏
- **WHEN** 用户保存 SDK 未收录的合法 Model ID
- **THEN** 模型列表正常展示，Choose model 可见且可选，不要求手工处理能力信息

#### Scenario: Test 失败后保存
- **WHEN** Test 因认证、404 或网络失败，用户关闭 Modal 保存有效配置
- **THEN** 保存可完成，失败检查与保存事实独立保留，模型仍可选择，Key 不回显

#### Scenario: 草稿与结果恢复
- **WHEN** Test 未返回时关闭/换页，或读回后查看旧结果
- **THEN** 结果不重新打开或覆盖其他目标，旧检查明确过期，查看不重发且非敏感草稿保留

#### Scenario: 字段与登录错误
- **WHEN** 输入字段无效、目标拒绝 Key，或 Console 登录失效
- **THEN** 分别定位字段、显示请求恢复或引导登录，不能将供应商错误当作管理员退出，也不能泄露原始错误/Key

#### Scenario: 平铺页面与窄屏
- **WHEN** 用户在桌面或 360px 打开列表/详情
- **THEN** 操作在统一标题栏，返回导航为 All models，无 Provider 管理残留或横向遮挡

#### Scenario: 长名称模型可管理
- **WHEN** 管理员在新增/编辑表单填写 129 或 256 字符名称，或读取由长 Model ID 生成的默认名称
- **THEN** 表单与 API 使用一致上限，完整值可保存、回读和继续编辑，360px 下可访问完整值与操作，超过 256 的值不能提交为成功

## MODIFIED Requirements

### Requirement: 配置全局运行时并区分保存结果

**Identifier:** SUI-CFG-002

运行时页 SHALL 查看 agent image、完整模型安全描述、modelRef、Key 可用性和更新时间。首次配置只需 Agent image 与模型选择；模型连接/Key 在 AI models 直接编辑，不在 Runtime 重复维护。

Choose model SHALL 列出已保存、启用且凭据可用的模型，包括自定义 ID；不以 SDK 目录、模板、Thinking 或 Test 结果过滤。停用、无 Key 或真实环境不兼容必须说明原因和恢复方向，不静默消失。空目录提供 Add model 入口；所有项不可用时展示相应原因，不能误称没有模型。已有选择不可用保留描述，不自动替换。

保存成功 SHALL 以 Core persisted 配置为准。已保存但环境未 ready 用英文分别说明两个事实及真实状态；校验/保存前失败保留旧配置与非敏感草稿，不自动重复提交。变更只更新后续新 Work 默认，不暗示旧 Work 已切换。旧深链接及 operator/env 初始化模型对应关系保留，不要求重新输入 Key。

#### Scenario: 首次选择自定义模型
- **WHEN** 用户在 AI models 添加 SDK 未收录的模型，回到 Runtime
- **THEN** Choose model 可直接选择，填写兼容 Agent image 后可保存/准备运行时，不需要其他配置步骤

#### Scenario: 首次配置
- **WHEN** 管理员填写有效 Agent image、选择已保存的完整模型并保存
- **THEN** 显示已保存配置、Key 可用性及真实 readiness，不重复填写 Key、不要求 Provider 或模板

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
