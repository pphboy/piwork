# Spec Delta

## MODIFIED Requirements

### Requirement: 模型只写凭据与独立轮换

**Identifier:** AIM-002

创建模型 SHALL 要求非空有效 Key；编辑省略 credential 保留，显式新值原子轮换，空值/空字符串拒绝。UI 空 Key 编辑输入表示省略，不回填旧值。Key SHALL 不进入管理读取、浏览器持久存储、公开列表/历史、日志或公开错误，只用于授权管理、secret 存储和当前获准模型私有执行。

轮换 SHALL 只作用于该模型，独立于其他条目，即使旧迁移条目曾共享连接或 secret。新获准 Run 使用当前 Key，无需重启 Work 或 Apply。已接受 Run 保持固定执行/凭据绑定，已发请求不重发；未开始且准入失效时安全失败。未知写入结果先安全读回，不自动重复轮换，旧 secret 不提前清理。

Key 轮换 SHALL 不主动停止或替换正在运行的 Work Agent。Core 重启后，对仍运行且通过当前身份及完整 readiness 核验的 Agent SHALL 接管原实例，不因启动挂载保留旧 Key 而改写材料、重建容器或中断已有 Run；新 Run 仍按当前模型授权和 Key 执行。Work 需要重新启动时 SHALL 使用本次启动解析并固定的模型凭证；与原代次已发布材料不同则按运行及生命周期契约切代，不要求用户重新选择模型、Apply、恢复旧 Key 或重建 Work。该过程 SHALL 保留已有模型执行定义、active/desired 关系及 Session/Run 历史。

#### Scenario: 编辑不重填 Key
- **WHEN** 管理员仅修改名称或其他非秘密字段并省略 credential
- **THEN** 原 Key 保留，公开读取只显示可用性，表单不回显 Key

#### Scenario: 同源模型独立轮换
- **WHEN** 两条模型来自同一旧 Provider，其中一条轮换 Key
- **THEN** 只有该模型的新 Run 使用新 Key，另一条模型及已有请求保持原行为

#### Scenario: 停止后轮换并恢复 Work
- **WHEN** Work 使用 Key A 完成过 Run，停止后管理员轮换为 Key B，用户再次 Start
- **THEN** Work 自动以绑定 Key B 的新运行代次恢复，原 Session 历史可读且后续获准 Run 使用 Key B，无需 Apply 或恢复 Key A

#### Scenario: 运行中轮换后接管
- **WHEN** Key 从 A 轮换为 B，原 Agent 继续运行，随后 Core 异常退出并重启
- **THEN** Core 验证并接管同一 Agent，已有执行不因接管被重放或取消，新获准 Run 使用 Key B，旧挂载不能绕过模型停用

#### Scenario: 启动过程中再次轮换
- **WHEN** 一次启动已持久固定 Key B 的绑定，启动完成前管理员又轮换为 Key C
- **THEN** 同一次启动及其崩溃续行保持原启动绑定，不反复改写或切换代次；激活后的新获准 Run 使用 Key C，执行前仍核验当前准入
