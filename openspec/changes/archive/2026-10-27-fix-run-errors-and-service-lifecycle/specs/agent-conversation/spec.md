## ADDED Requirements

### Requirement: Run 安全识别模型认证与权限失败

**Identifier:** CONV-MODEL-ERROR-001

系统 SHALL 在实际模型请求发生认证或授权失败且可从该请求可靠识别时，为原 Run 持久记录可区分的安全错误类别、固定消息与 `retryable=false`，在实时状态、Run 查询、重连和历史中保持一致。可确认 Key 无效时 SHALL 给出检查及更新 Key 的方向；仅确认认证被拒或权限不足时 SHALL 说明对应事实并指导检查 Key 或模型访问权限，不猜测特定原因。无权管理模型的用户 SHALL 获得联系管理员的方向；供应商认证失败 MUST NOT 注销用户或停止 Work。

限流、网络、取消、未知错误及工具返回的 HTTP 错误 MUST NOT 被误报为模型认证失败；无法可靠分类时 SHALL 保留安全通用错误。供应商原始错误正文、凭据、认证头及内部路径 MUST NOT 进入公开错误、Run 事件、日志或新增长期历史。确认认证或权限失败后原 Run 不自动重试、不更换模型或重放工具；修复配置后用户可显式提交新 Run，使用当时获准的凭据。

#### Scenario: 实际模型请求返回无效 Key
- **WHEN** 已受理 Run 的真实模型请求以可识别的认证错误拒绝合成 Key
- **THEN** 原 Run 显示明确的安全认证原因及处理方向、`retryable=false`，查询和重连结果一致，Work 保持原实际状态且不自动重发

#### Scenario: 权限不足与其他失败
- **WHEN** 模型返回权限不足，或请求限流、网络失败、工具访问返回 401
- **THEN** 权限失败不声称 Key 一定无效；其他失败不被误报为模型认证错误，所有结果不透传原始异常

#### Scenario: 轮换后的显式新 Run
- **WHEN** 管理员更新该模型 Key，用户提交新的 Run 并重新查看旧 Run
- **THEN** 新 Run 使用当前获准 Key，旧 Run 的身份、模型及失败事实不被改写或重放

#### Scenario: 恶意供应商响应
- **WHEN** 供应商错误包含合成 Key、认证头、内部路径或伪造的自然语言错误
- **THEN** 公开结果、事件、日志和新增历史不包含这些值，无法可靠分类时使用安全通用类别

### Requirement: Run 终结后衔接临时服务清理

**Identifier:** CONV-TEMP-SERVICE-001

Run SHALL 将正常完成、失败、明确取消及已确认的 daemon 中断与其已受理临时 Service 的收尾关联。系统 SHALL 不依赖后续模型调用或重放原 Run 发起清理；观察连接断开不等于取消。Run 终态与临时清理结果 SHALL 分别可查，清理失败或状态未知不得改写已提交 Run 的原终态或宣称资源已收尾。

#### Scenario: Run 取消后 Agent 仍存活
- **WHEN** 含临时 Service 的 Run 被取消并达到终态
- **THEN** 原 Run 保持 cancelled，关联临时 Service 自动进入清理，结果可查询且没有新模型调用

#### Scenario: Agent 在副作用附近退出
- **WHEN** 临时 Service 创建已受理而 Agent 在返回结果或清理前崩溃
- **THEN** 原 Run 按既有规则 interrupted，已受理临时 Service 继续自动收尾，不重放创建或原 prompt

#### Scenario: 用户仅断开观察
- **WHEN** Run 仍在执行但浏览器或 CLI 停止观察
- **THEN** 不因观察断开取消 Run 或提前结束其仍被使用的临时 Service
