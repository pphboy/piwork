# Design

## Context

动机见 proposal.md。当前代码已有目录持久化、两种协议 Test、只写 Key、执行绑定、Thinking 与模型选择，但用户必须先创建 Provider，再创建子模型；Runtime 又过滤 capabilityStatus=unconfirmed，Agent 也拒绝没有 SDK 定义/能力 JSON 的自定义 ID。因此仅改表单或取消下拉过滤，都不能完成“添加后可选且能发消息”。

本次修订覆盖先前 Provider 管理和能力模板前置决定。既有验收记录及 tasks 1–9 保留为历史，不作为新版设计已经实现的证据。固定 Pi SDK 仍为 0.86.1；宿主仍为 Go，容器保留 SDK harness。

## Goals / Non-Goals

**Goals:** 单模型配置一次完成；草稿可 Test，保存后直接选择；未知 Model ID 可按明确协议普通聊天，Thinking 能力独立表达；现有模型、Key、选择引用、Work 与历史保留。

**Non-Goals:** 不增加 Provider 管理、能力 JSON/模板步骤、管理员默认 Thinking、自动选模/failover、额外接口协议或用户自行填写上下文/价格参数。

## Decisions

### 1. 模型是唯一用户管理单位

每条模型配置包含稳定管理 id、可选显示名、api、baseUrl、model、私有 credentialVersion/ref、enabled、当前 modelRef 与时间。显示名为空时使用 Model ID。同一 Model ID 可以配置多个地址或 Key；选择器按显示名及安全标识区分，不以 Model ID 作为唯一键。

UI 只有 AI models 列表、新增/编辑模型和结果 Modal。POST models 一次发布完整连接与模型，不调用用户侧“创建 Provider”流程。内部可以复用现有连接/secret 材料，但它们不进入新的管理 DTO、页面、依赖修复步骤或操作前置条件。

备选是只隐藏 Provider 页面继续要求用户补充子模型/模板，不能满足一次配置即可选择，故不采用。

新模型的 Model ID 和显示名称以字符计数，最大均为 256；名称留空所产生的默认值也必须通过读取 DTO。Core 不通过截断新名称或缩短 Model ID 规避契约。新平铺 DTO 与仍为 128 字符的旧兼容 DTO 使用独立约束；旧兼容读取可以生成不超过 128 字符、保持有效 UTF-8 的显示别名，但不回写原始名称、管理 id、modelRef 或秘密，也不改变旧兼容输入限制。用 129/256 字符、省略/显式/清空名称、Unicode 及 257 字符拒绝验证完整路径。

### 2. 保留现有可靠的发布与捕获边界

稳定管理 id 与不可变 modelRef 继续分开。名称编辑不改执行身份；协议、端点、Model ID 或内部执行定义变化发布新 modelRef。Messages URL 的根地址、末尾 /v1 和尾斜杠统一规范化，同一有效地址表示不发布新版本。Responses 保留 API base 语义。

Key 先写 secret 后事务发布，省略保留、显式新值轮换、空值拒绝。每条模型独立授权和轮换，旧已接受 Run 固定其执行/凭据绑定，新 Run 使用当前 Key；停用撤销新准入，不停止容器或主动取消已发请求。模型被 Core 默认/非删除 Work active/desired 引用时不可删除，历史/Session 偏好只保留安全不可用描述。

不为单表单需求新增一套 Work context/历史机制。新默认只影响新 Work，旧捕获定义仍须显式选择/Apply 才改变；自动 Run 不继承聊天覆盖。

Work default 的可见身份来自当前 Work 公共模型描述的 `model`，而不是推断当前目录 head 的 Model ID。选择菜单、Response settings 和聊天输入区域同时表达 Work default 与其实际型号；友好 label 可保留，但不能单独替代实际型号。复用现有公开字段，不新增端点、凭据或私有定义投影。仅修复显示，不进行自动重绑、Apply、重启或历史改写；捕获旧型号而目录 head 已更新时，用户仍可明确辨认两者。长型号在 360px 下允许换行且完整身份可访问。

### 3. 模型直接可选，SDK 自动注册未知 ID

Runtime 的 Choose model 依据已保存、enabled、凭据可用列出模型，不按 SDK 是否收录、模板存在、Thinking 状态或 Test 结果过滤。Work Chat 再检查实际 Agent 协议/版本兼容性；真正不兼容的旧环境显示明确升级方向，不能静默隐藏或改用其他模型。

Agent 共用解析函数自动解析精确协议/Model ID/端点：

- SDK 已知且协议匹配的定义自动复用其上下文、输入、reasoning 和映射；已有有效私有定义保留，不要求用户重填。
- 未知 ID 按所选 Responses/Messages 建立内部普通消息定义，以原 ID 和原端点执行；必要的有界上下文/输出预算由平台内部提供，属于适配预算，不宣称已证实真实模型上限。
- 不按名称猜测另一个官方模型，不以 Test 成功推导 Thinking/工具/多模态能力。请求的模型身份不被模板替换，已知 Thinking 映射不因通用适配丢失。

执行定义及来源随不可变绑定私有捕获，能力查询和执行使用同一解析结果。普通消息可运行是验收条件，不能仅让未知 ID 出现在下拉后仍在初始化时拒绝。

### 4. Thinking 与基本消息解耦

已知模型的真实档位、Off 请求语义、默认建议值及完整设置对原子保存保持现状，不新增管理表单档位。未知模型仍可选、可作为默认并发普通消息；其 Thinking 显示未确认，不提供伪造档位，也不称为已确认“不支持”。

新增量 Chat 契约明确表达 thinkingAvailability=unknown、空 thinkingLevels，以及 thinkingLevel=null 的普通模式。null 表示未请求额外 Thinking，普通模式不附加未经确认的 reasoning/thinking 参数；它与已知模型明确 Off 不同。新建未知模型 Session 可直接正常发送，无需用户补模板或填写额外字段；自动 Run 的未知默认同样使用普通模式。

已知模型继续使用原枚举档位。已有非空 Thinking 偏好不得静默改成 null；切换到未知模型时保留原设置并说明不兼容，由用户显式确认普通模式后原子保存。缺少 Thinking 的旧记录仍按旧 Off 解释，新 null 记录不得被 ??off 等兼容逻辑改写。

Chat 能力版本升级并协商 nullable/unknown；Go/TS 历史、快照及公开/私有验证同步。旧读取器或客户端无法表达新值时明确不兼容，不伪造 Off；新版继续读取旧事实。用户看到的是普通消息可用和 Thinking 未确认，不需要理解能力定义结构。

### 5. 直接模型 API 与 Test

新管理路径以 /admin/models 为中心：POST 完整模型、GET 列表/详情、PATCH 修改、POST enable/disable、DELETE 依赖保护。Model DTO 返回 id/name/api/baseUrl/model/modelRef/enabled/credentialAvailable/时间；不返回 providerId/providerName/providerEnabled 或能力 JSON。

Test 保留 /admin/model-tests，仅需要完整模型草稿或 modelId 加编辑覆盖；无 providerId 前置步骤。草稿名称不是测试必填项，已有模型省略 Key 使用其保存值。固定 Reply with OK. 仍通过 Go net/http 单次非流式请求，两协议正文提取、20 秒/64 KiB/8 KiB 限制、Key 屏蔽、权限重验、无重试/无业务写入边界保留。

Modal 保留实际回复、错误来源、字段定位、恢复建议、截断/过期及关闭后的晚到结果隔离。Test、保存、启用独立；供应商请求错误在文案中可称“目标接口错误”，但不重新引入 Provider 管理对象。

旧 Provider API/深链接仅可保留为受控兼容入口或安全跳转，不作为新 UI/客户端依赖；旧 operator/env 完整初始化形式继续转为完整模型配置，provider 字段只保留协议逻辑语义。

### 6. 保留旧数据并隔离后续模型编辑

在现有 control_metadata/catalog_entries 上使用明确的新 registry 版本，不为此改写 SQLite 表。旧 Provider 的每个已保存子模型映射为独立模型配置，保留管理 id、modelRef、规范化连接、Key 可用性及有效 enabled 状态。映射幂等，重启不重复生成，不清空数据或启用旧停用项。

多个旧模型可以暂时引用同一已发布 secret 文件，但后续轮换只更新该模型的授权版本；修改地址/协议亦不影响兄弟模型。旧不可变绑定的非秘密身份保留，授权通过明确模型映射解析，不能因为隐藏 Provider 而使旧 Work 默认失效或偷偷更换端点。

无子模型的旧 Provider 不凭名称猜测创建模型；仅保留必要内部材料。旧显式能力定义可用于兼容已存在模型/历史，但新 UI 不要求或展示它。旧 Provider 单独启停/删除行为退出新版用户流程，管理依赖只以模型及其引用说明。

### 7. 交付与验证

```text
AI models: Model ID + API + Base URL + Key
                   |
            Test --> result Modal
                   |
                 Save
                   |
       Runtime / Work Chat: Choose model
                   |
          private binding + Pi SDK
                   |
          Responses / Messages
```

| 范围 | 责任 |
| --- | --- |
| contracts / Go 生成物 / 私有 proto | 平铺模型 CRUD/Test、Thinking unknown/null 与增量协商，严格验证 |
| coreapp registry / binding / settings | 完整模型事务发布、独立 Key、旧数据映射、默认/捕获/删除边界 |
| agentd / pi-adapter | 已知 SDK 复用与未知 ID 普通注册，同一解析贯通选择/初始化/执行 |
| Console / consoleapp | 单表单、无 Provider/能力 JSON、结果 Modal、Runtime 直接选择 |
| Desktop / work-store / workhistory / snapshot | 模型可选、Thinking 分离、旧事实及普通模式严格保存/迁移 |
| docs 与联合验收 | 从新增未知 ID 到实际 SDK 消息的完整路径，明确旧环境升级 |

## Risks / Trade-offs

- [未知模型实际不接受协议/工具] → 按原身份安全报错，不猜另一模型；Test 成功仅证明该次短消息，不能重新变成保存/选择门槛。
- [仅移除 UI 过滤] → 必须用不在 SDK 目录的合成 ID，验收 Runtime 默认与同 Session 手动 Run 实际请求。
- [普通模式被误报成已确认 Off] → unknown/null 通过明确契约、UI 和历史校验表达，已知 Thinking 保持真实请求映射。
- [默认名称或旧兼容投影超过契约上限] → 新模型全路径统一 256 字符，旧 128 字符 DTO 仅做安全显示映射并验证返回合法性，不回写截断。
- [友好名称掩盖旧 Work 捕获型号] → 显式显示现有描述的实际 Model ID，目录改名不伪装为已 Apply。
- [迁移丢引用或共享 Key 相互影响] → 当前格式夹具、幂等恢复及兄弟模型独立编辑回归，旧绑定/秘密保守保留。

## Migration Plan

1. 在独立数据夹具实现新 registry 兼容读取与映射；保留旧目录数据、ID、引用和秘密，不写真实 Key 到报告。
2. 同步模型直接 API、Console/Runtime 与支持普通注册/Thinking 新契约的 harness/Desktop。旧镜像有明确兼容说明，不自动 Apply 既有 Work。
3. 用两协议、未知 ID、不同端点/Key 及旧数据完成真实 Core/Console/Desktop/SDK 验收，重建 Go 嵌入资源和镜像。
4. 回退使用升级前私有完整数据副本及对应二进制，不让旧程序把新 unknown/null 或 registry 版本误读为旧事实。本次规划更新不执行部署。
