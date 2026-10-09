# Proposal

## Why

当前已实现的 Provider → Model 两层管理与能力模板前置要求，使用户完成连接测试后仍无法在 Choose model 选择模型。用户需要的是一个直接可用的操作路径：添加模型、Test、保存，然后在 Runtime 或 Work Chat 选择；不应要求理解 Provider 管理或 SDK 模型目录。

复验发现两项追加修复：新模型名称的 128/256 长度边界不一致，以及目录改名后 Work 默认标题容易掩盖实际捕获型号。本次修订纳入这两项，不改变单模型配置的目标；既有完成记录与验证发现保留，新增修复任务独立验收。

## What Changes

- **BREAKING** 管理流程调整为以模型为唯一配置单位：填写 Model ID、接口协议、Base URL、只写 API Key，显示名称可选，省略时使用 Model ID。一次保存创建一条完整模型配置。
- 新模型的 Model ID 和显示名称统一支持最多 256 个字符，创建、编辑、默认名称生成及读取使用一致契约；旧 Provider/ManagedModel 兼容接口的 128 字符限制通过安全显示投影处理，不截断新模型原始名称或修改身份。
- Work default 选项、响应设置与聊天输入区域明确展示实际捕获的 Model ID，显示名更新不暗示已有 Work 已采用新型号，也不改写历史、Thinking 或默认选择。
- 移除 Serve UI 的 Provider 创建、详情、分组和先建连接再加模型的步骤，以及能力模板/Capabilities JSON 配置入口。每个模型独立编辑连接、轮换 Key、启停和受引用约束的删除。
- 仍只支持 OpenAI Responses 与 Anthropic Messages。Messages 根地址和末尾 `/v1` 写法自动兼容，保存、Test 与实际执行使用同一规范化规则。
- 在新增/编辑模型表单中直接 Test 当前草稿，也可检查已保存模型。固定短消息的实际回复、错误原因和恢复建议在 Modal 展示；Test 不自动保存，也不作为保存或启用的前置条件。
- 已保存且启用、凭据可用的模型直接进入 Runtime 的 Choose model；兼容的已运行 Work 可刷新并选择。自定义 Model ID 不因 SDK 未收录、Thinking 未确认或没有模板而被隐藏。
- Agent 自动复用 SDK 已知模型定义；未知 ID 自动按所选协议建立普通消息执行定义，不要求用户补充能力 JSON，也不猜测另一个模型作为替代。
- 已知模型保留真实 Thinking 档位与映射。未知 Thinking 与基础模型可用性分开表达，普通消息可以运行，不伪造能力或静默降档；不增加管理员默认 Thinking 设置。
- 保留模型捕获、Key 轮换、手动 Session 选择、在途 Run、权限、历史与包迁移边界。旧 Provider 下已保存的模型平铺保留为独立模型配置，无需重输 Key；旧验收仅作为历史事实，不代表本次简化已实现。

## Capabilities

### New Capabilities

- `ai-model-management`: 独立模型配置的新增、编辑、只写凭据、消息 Test、启停、删除约束和直接可选性；Provider 不再是用户管理对象。

### Modified Capabilities

- `core-admin-api`: 提供完整模型配置的直接管理接口，Test 接受模型草稿/保存项；Runtime/default-work 引用该模型，不再要求 Provider 管理步骤。
- `serve-ui-configuration`: 单层模型列表与单表单操作，移除 Provider/能力 JSON 页面；Choose model 显示已保存模型及真实不可用原因。
- `agent-conversation`: 自定义 Model ID 可选并可普通聊天；Thinking 的确认状态与模型权限/基本执行能力分开，保留 Session 与 Run 设置事实。
- `runnable-work-runtime`: 自动建立明确协议的执行定义，私有传递当前模型所需凭据，普通模式与真实 Thinking 语义不混淆。
- `work-configuration`: 独立模型编辑与 Work 捕获配置分开，保留默认/自动执行及 Key 授权边界。
- `portable-work`: 按协议、Model ID、规范化端点和执行必要定义迁移模型依赖，不复制源管理身份或凭据。

## Impact

- Go Core、公开 DTO、Console 代理改为模型直接 CRUD/Test；现有存储可保留内部连接材料，但不得成为用户必须操作的层级。
- Agent 的 SDK 注册、Thinking 查询及执行共用自动解析路径，修复仅移除选择器过滤但实际仍拒绝自定义模型的问题。
- Console/Runtime/Desktop 选择器、增量 Chat/私有契约及历史验证同步；新行为需要相应 harness 与浏览器资源，旧固定 Work 镜像仍由用户显式升级。
- 对已有目录做保留身份、引用和 Key 的兼容映射；同一旧 Provider 下多个模型的后续编辑/Key 轮换互不影响。
- 用户文档和验收围绕“添加模型 → Test → 保存 → 选择 → 实际发送”更新；不扩展到自动选模、额外协议、发行或远程部署。
