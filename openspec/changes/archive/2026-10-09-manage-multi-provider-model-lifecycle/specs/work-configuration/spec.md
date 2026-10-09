## ADDED Requirements

### Requirement: 区分模型目录变化与 Work 捕获模型

**Identifier:** WCFG-MODEL-001

Work 创建、模型选择和 Apply SHALL 捕获所选完整模型的协议、Model ID、规范化端点、内部执行定义/来源及平台准入绑定；未知 ID 可捕获自动普通定义，不要求用户补模板。后续模型名称或 Core 默认变化不得重写 active/desired 或隐式 Apply。协议、端点、Model ID 或执行定义变化发布新 modelRef，旧 Work 保留捕获事实，显式重选/Apply 才采用新定义；同一有效 URL 表示不产生新版本。

每条模型凭据 SHALL 独立管理，新 Run 仍受轮换与启停准入约束；旧 context 不绕过停用，轮换不改协议/模型/地址，不产生 pendingApply。当前 Key 不适用于原捕获端点时明确失败，不偷偷更换端点。停用不修改 Work lifecycle state；active/desired 仍引用时不能删除，用户可显式切换模型。

Session 手动选择 SHALL 独立于 active/desired，不产生 pendingApply。自动 Run 使用 active 默认；已知 Thinking 按原行为，未知默认为明确普通模式，不继承聊天覆盖或因添加模型自动路由。

#### Scenario: 默认与模型端点编辑
- **WHEN** Work 捕获 E1，管理员将该模型新配置改为 E2 并调整 Core 默认
- **THEN** 旧 Work 的配置/镜像/捕获 E1 不变，新 modelRef 使用 E2，需显式重选/Apply 才更新旧 Work

#### Scenario: Key 轮换不产生 Apply
- **WHEN** 只轮换一个模型的 Key
- **THEN** 该模型新获准 Run 使用新 Key，Work 配置/pendingApply 不变，其他模型不受影响

#### Scenario: 停用不停止 Work
- **WHEN** 管理员停用默认模型
- **THEN** Work lifecycle 不变，默认的新执行拒绝，ready Chat 可选择其他可用完整配置

#### Scenario: 自动执行不继承聊天偏好
- **WHEN** 用户选择聊天覆盖模型后 Service 触发自动执行
- **THEN** 自动执行仍使用 active 默认及其真实模式，不可用则失败，不选另一个模型

#### Scenario: 未知默认模型可初始化
- **WHEN** 新 Work 选择已保存的自定义 Model ID 和兼容镜像
- **THEN** 捕获完整普通执行定义并可启动，不要求 Provider/能力 JSON，既有 Work 不被隐式变更
