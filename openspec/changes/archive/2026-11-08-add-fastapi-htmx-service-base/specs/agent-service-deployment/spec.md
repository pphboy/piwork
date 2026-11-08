# Spec Delta

## ADDED Requirements

### Requirement: 沿既有部署路径交付内置 FastAPI 应用

**Identifier:** ADEP-004

选择内置 FastAPI + htmx 环境时，部署指导 SHALL 在 ADEP-002 的同一路径内完成实际能力发现、安全初始化、必要 Service Spec、受影响检查、Service 创建/更新、原 Operation 观察及运行版本和业务验证。Python 与依赖准备 SHALL 在 Service 环境执行，Agent 使用其实际授权工具编辑共享 workspace；不能假定 Agent bash 自带 Python/pip，不能通过 Docker exec/build、宿主后台进程或额外权限替代原流程。

FastAPI 应用 SHALL 满足 WEBBASE-010 至 WEBBASE-015，并保留现有 WAF-001 至 WAF-009 的能力、幂等 Action、Job、必要事实、明确反馈及恢复语义。初始化、检查或部署失败时 SHALL 保留真实错误和原数据，停止依赖失败结果的后续操作；未知业务副作用沿原标识核对。成功交付 SHALL 包含应用实际生效及受影响页面的可用证据；缺少获准浏览器能力时按 BRN-014 区分后端结果与页面未验证事实。

#### Scenario: 从用户意图完成部署
- **WHEN** 用户要求使用 FastAPI 创建持久工作站，当前 Work 具备获准工具和匹配的可用环境
- **THEN** Pi 沿既有 SDK/MCP 完成 Spec、源码、检查、Service 部署及实际业务验证，不把 create 接受或文件写入当完成

#### Scenario: 初始化或检查失败
- **WHEN** 已有目标导致初始化被拒绝，或应用检查失败
- **THEN** Pi 不继续基于失败结果创建/更新 Service，不用旧幂等回执掩盖失败，原代码与业务数据保留

#### Scenario: 修改应用后主动完成生效
- **WHEN** 用户要求修改 FastAPI 应用页面或业务逻辑
- **THEN** Pi 完成必要检查、部署和实际加载版本/业务核对，模板按对应机制自动采用变化，不把重启或刷新留给用户

### Requirement: 用真实执行验证 FastAPI 示例的业务闭环与可修改性

**Identifier:** ADEP-005

产品验收 SHALL 在独立安装和数据范围使用确定性模型、真实 Pi SDK、当前脑包、MCP/gRPC、Docker 和浏览器，验证 FastAPI starter 的部署、UI/Agent 共享业务、页面访问事实、反馈触发改进、异步导出及原 Job 续接、Evidence 和下一次执行采用经验。SHALL 沿用 ADEP-003 的失败恢复、候选 Update/显式 Apply/实际行为验证及两份独立导入的业务边界，不以固定模型脚本证明任意模型都能自主完成任务。

验收 SHALL 覆盖 Work Stop/Start、Core 正常重启、Action 副作用附近中断后按原标识恢复、重复初始化拒绝、业务读取失败/恢复、输入保护、前缀深层访问、离线资源和额外依赖复用。FastAPI 的浏览器验证 SHALL 观察真实 htmx 行为，不以 NiceGUI 专有连接或仅 HTTP 200 作为替代。NiceGUI 默认路径 SHALL 有回归证据。

SHALL 通过同一示例的两个实际修改回合核对工程坐标：一次仅页面/样式修改，一次业务规则修改；两者均更新受影响 Spec 坐标和测试、实际部署并验证运行效果。结果 SHALL 绑定对应源码、脑包、镜像及输入身份，说明已测/未测范围；本变更不以超越 NiceGUI 的交付速度作为通过条件。

#### Scenario: 完整运行和独立分享
- **WHEN** FastAPI 示例完成真实 SDK 部署、反馈改进与异步导出，随后停止并导出，再独立导入两份
- **THEN** 导入均保持 stopped，显式 Start 后分别保留代码、数据和依赖，处理自己的新反馈及候选验证，源历史事件和 Job 不重放

#### Scenario: 页面修改回合
- **WHEN** SDK 修改示例的 Jinja2 页面/片段或 CSS，用户页面保持打开且保有草稿
- **THEN** 相关坐标、页面检查和运行版本可核对，页面自动采用新效果并重新初始化表单而不恢复旧输入，UI 与 Agent 原业务行为保持一致

#### Scenario: 业务修改回合
- **WHEN** SDK 修改一项独立业务规则并完成检查及部署
- **THEN** UI 和 Agent 查询/操作体现同一新规则，纯业务修改保持 frontendVersion，业务结果和 Evidence 证明生效

#### Scenario: 失败与未知结果不被成功记录覆盖
- **WHEN** 部署检查失败、原 Action 响应未知或业务读取失败后恢复
- **THEN** 各自保留真实失败/未知事实并沿原对象处理，页面不恢复已经发送的输入并正确表达未确认或陈旧状态，不通过新 mutation、手动刷新或旧候选证据冒充通过
