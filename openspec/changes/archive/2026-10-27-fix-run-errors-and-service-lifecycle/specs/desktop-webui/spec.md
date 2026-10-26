## ADDED Requirements

### Requirement: 模型认证失败提供可执行方向

**Identifier:** DWUI-MODEL-ERROR-001

Desktop SHALL 在 Run 实时结果、详情和重开历史中一致显示经安全分类的认证或权限失败，说明应检查密钥或模型访问权限；提供与当前用户权限相符的模型管理入口或联系管理员的方向。界面 SHALL 不因供应商认证失败退出平台登录，不建议直接重试未修复的请求；旧 Agent 的通用错误仍可读且不伪造分类。

#### Scenario: 无效模型 Key
- **WHEN** 当前 Run 返回已确认的模型认证失败
- **THEN** 聊天和详情显示安全原因及适合当前权限的处理方向，重连后保持一致，旧 Run 不自动重新发送

#### Scenario: 旧 Agent 通用错误
- **WHEN** 旧 Agent 只返回原有通用执行失败
- **THEN** Desktop 保留原错误及可观察状态，不根据文本猜测认证原因

### Requirement: Work 降级和临时清理原因可查

**Identifier:** DWUI-SERVICE-CAUSE-001

Desktop SHALL 根据已确认 Service 状态显示造成 Work Degraded 的服务身份、可确认原因、影响范围和现有详情/处理入口；多个故障分别可查。恢复、停用或移除后 SHALL 依据当前已确认状态刷新提示；仍有其他故障时继续显示真实影响。读取失败或状态未知 SHALL 说明未确认，不把旧故障、空结果或猜测显示为当前事实。

临时服务的清理进行中、失败/待重试及确认完成 SHALL 在获准的 Work/Run 相关入口可查，用户能够定位真实清理记录与安全日志；日志不可用不阻止查看当前状态和合法控制。非所有者不获得私有内容。

#### Scenario: 服务退出导致降级
- **WHEN** 可选常驻 Service 运行后退出且 Work 确认 Degraded
- **THEN** 用户能识别该服务、退出原因、其他可用能力及进入服务详情/日志的入口

#### Scenario: 服务全部恢复
- **WHEN** 所有导致降级的服务已确认 ready、disabled 或 removed，Agent 仍 ready
- **THEN** Work 显示 Ready，旧降级提示消失，但历史诊断仍可查询

#### Scenario: 临时清理尚未确认
- **WHEN** 已结束 Run 的临时清理因 Docker 故障待重试
- **THEN** 界面显示关联对象、未确认状态、安全原因和可查询的清理记录，不宣称已删除或重发 Run
