## ADDED Requirements

### Requirement: 临时服务清理具有持久且清晰的安全诊断

**Identifier:** WDIAG-TEMP-001

系统 SHALL 为每个受理的临时 Service 收尾提供可持久查询、Work 权限限定的清理状态或 Operation，并关联真实存在的 Work、Service、Run、创建 Operation、清理 Operation 和 correlationId；未知身份 SHALL 缺省，不伪造可导航 Operation。结果 SHALL 区分已请求、进行中、确认完成、失败、待重试及状态未知，并提供安全错误码、阶段、时间和明确处理方向。

清理请求、精确实例核对、停止、移除、配额释放与恢复重试 SHALL 产生可关联的结构化开始和结果日志；可查询的终态和未完成原因 SHALL 在 Agent/Core 重启及容器移除后保留。日志与持久诊断沿既有容量上限和截断规则有界；持久化失败 SHALL 如实报告，不能声明清理已持久完成。

安全日志和诊断 MUST NOT 包含模型 Key、认证头、原始供应商错误、完整命令、环境变量、宿主路径或容器输出。Service 输出属于受授权的有界非可信内容，独立读取，不覆盖原退出原因或清理失败；收集失败 SHALL 单独说明，不伪造来源或抹去主要错误。

#### Scenario: 清理成功后的审计
- **WHEN** 临时探测结束且清理已确认完成
- **THEN** 所有者可按关联身份查看清理过程和终态，结构化日志含安全时间、阶段及结果，删除容器和重启 Core 后仍可核对

#### Scenario: 清理失败并恢复
- **WHEN** Docker 不可达导致临时 Service 清理失败，之后自动重试成功
- **THEN** 记录明确失败原因及待重试，后续记录同一目标的重试及确认完成，不将先前失败抹成未发生

#### Scenario: 诊断及日志中的不可信值
- **WHEN** 容器输出或供应商响应包含合成秘密、路径和伪造错误消息
- **THEN** 安全日志及持久诊断只含允许字段和固定消息，受授权内容日志遵守原有有界及脱敏规则

### Requirement: 当前服务故障与清理记录分别可访问

**Identifier:** WDIAG-SERVICE-CURRENT-001

获准用户 SHALL 能查看常驻 Service 当前安全故障及对应状态；临时服务清理记录 SHALL 与原 Run/创建结果独立，不能将相关已成功 Operation 改写为失败。当前故障清除不删除依法保留的操作历史或清理历史；无权访问者不得获得其他 Work 的状态或内容。

#### Scenario: 运行后退出但创建曾成功
- **WHEN** 常驻 Service 的创建 Operation 已成功，服务随后退出
- **THEN** 当前 Service 诊断描述实际退出，原创建 Operation 保持成功，退出码与阶段只在已确认时显示
