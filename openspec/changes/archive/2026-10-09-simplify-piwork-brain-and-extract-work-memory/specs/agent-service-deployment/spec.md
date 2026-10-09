# Spec Delta

## MODIFIED Requirements

### Requirement: Guide deployments using persistent code and explicit verification

**Identifier:** ADEP-002

脑包默认认知 SHALL 将 Service 开发细节路由到现有部署 Skill 与 Reference；部署 Skill SHALL 指导 Pi 查询 deployment_context 确认 workspace、工具和配额，将代码放在 apps/<service-name>、业务数据放在 data/<service-name>，使用已有运行镜像、固定可复现依赖安装、监听 0.0.0.0 并解析 Work 私网端点。Pi SHALL 显式更新匹配服务、使用稳定 mutation 键和预期定义版本、查询持久 Operation、失败及日志，并从 agentd 验证实际应用后才报告成功。

创建或修改持久且由 Pi 开发维护的 Service 之前，Pi SHALL 自动先维护 apps/<service-name>/SPEC.md 的必要设计，包含 Intent、Objects、State、Business Flow、Agent-operable Capabilities、Implementation Map 和 Acceptance Criteria。首次创建形成最小文档；已有 Service 先读当前 Spec 与受影响代码，仅更新相关条目与实现坐标；缺失旧 Spec 时根据真实代码和用户目标补齐最小依据后再改实现，不要求用户补文档。不因普通 Query / Action 操作改 Spec 或启动开发测试。

实现 SHALL 使用现有项目测试验证相关 Acceptance Criteria，并读取实际 Service 状态与 Evidence；UI 与 Agent 业务入口复用同一业务逻辑与权威状态。失败保留真实结果，能自主修复时采用有界最小修复，受自动目标原预算约束，不通过删除失败用例或降低验收条件冒充通过。修改文件、Spec 和测试/业务结果 SHALL 通过原有 SDK 工具记录、Files、请求/Evidence 与 Chat/CLI 结果可查，不新增开发账本或 Eval 引擎，不要求额外人工 Spec/Plan/Eval 审批。

Pi 开发维护的 Service SHALL 同时完成 WAF-001 至 WAF-009 的状态查询、Action/Job、必要 Event、反馈请求和验证路径；不能把观测及自动反馈留作下一阶段。第三方代码遵循 BRN-002 的外部观察范围。Service 代码修改 SHALL 保留恢复依据，代码/配置恢复与业务数据补偿分开。语言及框架自由，参考示例不成为所有 Service 的前置技术栈。

Skill SHALL 区分进程 readiness 与应用可用、Stop Service 的持久禁用与 Stop Work，并解释共享存储和可复现启动。agentd 内后台进程、Skill 加载或 create 接受不得被当作成功持久部署，修复不得清除共享业务数据。

#### Scenario: User requests persistence
- **WHEN** 用户要求工作站在 Work 重启后持续使用
- **THEN** Pi 通过 SDK/MCP 完成代码与数据落地、服务部署和业务交互验证，状态与反馈路径一起交付

#### Scenario: Dependencies need installation
- **WHEN** 应用依赖不在已有镜像中
- **THEN** 使用 workspace 中固定可复现安装/启动流程或明确失败，不要求运行中的 Pi 构建镜像

#### Scenario: Tools are unavailable
- **WHEN** MCP 被移除、部署/业务工具被 deny 或脑包必要能力不可用
- **THEN** Pi 说明缺失能力及实际限制，不以本地后台进程、未接通事件或推测结果报告完整交付

#### Scenario: 创建 Service 先形成 Spec
- **WHEN** 用户通过自然语言要求创建可操作的 kanban
- **THEN** 实际 SDK 首次业务实现写入之前已有最小 SPEC.md，部署后 UI / Action 共享状态，受影响测试和真实查询结果提供验证依据

#### Scenario: 修改既有功能只更新影响范围
- **WHEN** 用户要求增加 kanban 的业务规则
- **THEN** Pi 读取并更新该规则的 Spec、Acceptance Criteria 和 Implementation Map 后修改相关实现，运行目标回归测试并实际查证，不要求用户逐步确认

#### Scenario: 测试失败如实收尾
- **WHEN** 受影响测试或实际业务验证失败且有界修复仍未解决
- **THEN** 结果说明已完成的变更与未验证部分，保留真实失败输出和旧验收依据，不报告 Verified 或提交有效失败经验
