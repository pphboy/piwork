# Spec Delta

## ADDED Requirements

### Requirement: Go 客户端转发当前模型与处理记录并保留原身份

**Identifier:** CLI-BRAIN-001

用户 CLI 和 Desktop 本地后端 SHALL 使用 Go Core 的当前模型、Session/Run 来源、请求和证据接口；公开投影 SHALL 排除平台密钥与内部路径。既有 chat 命令的参数和单槽语义保持，省略模型选择时遵循 Session 偏好；本次不新增自动流程顶层命令。Run 查询 SHALL 能报告真实模型和来源。

Desktop 本地后端 SHALL 按当前 Core/账号/Work 验证请求、转发模型偏好和请求取消/重试、分页读取证据，并沿用本地授权、CSRF、凭证并发及原 ID 记录规则。接受结果与后续读取分开；断线、导航、身份变化不隐式取消或重复提交。未知修改只能核对原对象。

#### Scenario: Desktop 与 CLI 查询同一 Run
- **WHEN** Desktop 选择模型并提交后，所有者使用 Go CLI 按原 Run ID 查询
- **THEN** 两个入口报告相同实际模型、来源与状态，不取得模型 secret

#### Scenario: 接受后刷新失败
- **WHEN** 本地入口已取得原 Run/请求/Operation 回执但关联读取失败
- **THEN** 原 ID 与接受事实保留，只提供原对象查询恢复，不自动重发修改

#### Scenario: 身份改变时晚返回
- **WHEN** 请求在旧 Core/账号下发出，返回前用户切换身份
- **THEN** 旧内容不进入新身份、不释放新动作的锁，同身份已接受结果仍可按原 ID 找回
