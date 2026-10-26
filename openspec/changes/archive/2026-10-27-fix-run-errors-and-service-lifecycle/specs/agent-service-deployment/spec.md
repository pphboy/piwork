## ADDED Requirements

### Requirement: 一次性检查使用明确生命周期

**Identifier:** ADEP-TEMP-001

脑包认知与部署 Skill SHALL 指导 Agent 针对一次性探测优先使用获准的 Agent 命令或现有应用接口；所需运行时只存在于目标镜像时，SHALL 使用明确的 Run 临时 Service 能力，不以普通常驻 Service 冒充一次性任务。Agent SHALL 读取实际结果及必要日志，并在完成后请求清理和观察确认；不以已受理操作声称执行或清理成功。

临时能力、命令或权限不可用时 SHALL 报告限制，不绕过工具策略或假定 Agent bash 有 Service 镜像里的 Python/pip。保留持久应用的已有部署、依赖安装、SPEC 和业务验证规则。工具提示、Skill、Reference 与真实 SDK 行为验收 SHALL 采用一致语义。

#### Scenario: Agent 可以直接执行探测
- **WHEN** 一次性检查能由 Agent 已获准的命令或现有应用接口完成
- **THEN** Agent 使用相应能力并核对结果，不创建新的启用常驻 Service

#### Scenario: 探测必须使用目标镜像
- **WHEN** 一次性检查需要 Service 镜像中的运行时且临时能力可用
- **THEN** Agent 明确创建 Run 临时 Service，核对真实结果并请求收尾，不留下启用的失败常驻服务

#### Scenario: 临时能力不可用
- **WHEN** 当前 Agent、Core 或工具策略不支持该临时模式
- **THEN** Agent 说明实际限制，不静默改成常驻服务或绕过权限
