# Serve UI Configuration Specification

## Purpose

提供 Core 状态、全局运行时及默认 Work 配置的浏览器管理流程，明确保存与 readiness 的区别、局部配置提交以及 AGENTS 内容编辑，使管理员能够完成部署后的配置并理解这些默认值对新 Work 的作用。

## Requirements

### Requirement: 展示 Core 的真实管理状态

**Identifier:** SUI-CFG-001

状态页 SHALL 显示 Core 是否可达、健康、readiness 原因和公开 checks，提供手动刷新并在页面可见时每 15 秒刷新。初始化缺管理员 SHALL 在登录入口指向 CLI/env bootstrap；已登录但运行时缺失 SHALL 链接运行时配置。Core 返回非 ready SHALL 展示 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE` 等实际原因，不能将健康等同于可创建 Work。查询失败 SHALL 标记旧数据及其时间，禁止把旧 ready 显示为当前 ready。

#### Scenario: 健康但未配置运行时
- **WHEN** Core 健康且 readiness 为 RUNTIME_NOT_CONFIGURED
- **THEN** 以英文说明 Core 可达但运行时未配置并提供配置入口，其余可用管理页仍能打开

#### Scenario: 丢失 Core 连接
- **WHEN** 曾显示 ready 的页面刷新失败
- **THEN** 显示当前不可达，旧结果标记为历史状态，恢复后可重新获取

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

### Requirement: 按编辑字段更新默认 Work

**Identifier:** SUI-CFG-003

默认 Work 页 SHALL 查看完整公开 configuration，并为 base image、Skills、packages、AGENTS 内容提供编辑。其他公开字段可以只读展示。Skills SHALL 按名称从启用项中选择并保持用户顺序，支持调整顺序及显式清空；packages SHALL 从启用 Core catalog 中多选、最多 64 个、可显式清空。当前选择若已不可用 SHALL 显示其名称和无效原因，不静默丢弃。Default Skills 没有选择时 SHALL 明确显示空状态，不能仅显示排序标题；选中项 SHALL 在本行提供可读取或可复制的完整名称、选中顺序及其可用状态。名称过长时 SHALL 在本行换行或提供紧邻的完整名称访问方式，不因溢出遮挡排序、移除或保存。重复的排序动作 SHALL 使用简短可见标签，并以包含完整 Skill 名称及方向的无障碍名称区分目标；不可用项的原因 SHALL 紧邻该项，且在用户处理前继续保留在草稿中。

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

### Requirement: 从文件或编辑器保存 AGENTS 内容

**Identifier:** SUI-CFG-004

AGENTS 编辑区 SHALL 允许选择本地 UTF-8 文本文件或直接编辑现有内容，字段及帮助文案统一使用 `AGENTS.md`。选择文件 SHALL 只在浏览器读取并填入编辑器，不要求服务器路径、不立即保存；已有未保存内容被替换前 SHALL 确认。文件选择取消、读取失败、非法 UTF-8 或超过 256 KiB SHALL 保留原草稿。直接编辑也 SHALL 按 UTF-8 字节数执行 256 KiB 限制；空文本表示显式清空。保存 SHALL 提交文本原文，不提交文件路径或自动解析 Markdown 指令。

#### Scenario: 选择后继续编辑
- **WHEN** 管理员选择合法文件，再编辑其中一行并保存
- **THEN** Core 保存编辑器中的最终文本，后续读取一致，原文件路径不进入 Core

#### Scenario: 文件超限或无效
- **WHEN** 选中文件超过限制或无法按 UTF-8 解码
- **THEN** 显示具体错误，已有编辑内容和服务端配置不变

#### Scenario: 临界大小与清空
- **WHEN** 文本编码后恰为 256 KiB，或管理员清空内容
- **THEN** 两者可提交；大于 256 KiB 时阻止提交并提示超限

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
