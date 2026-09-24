# Spec Delta

## ADDED Requirements

### Requirement: Restore service definitions independently from source runtime state

**Identifier:** WSRV-SNAPSHOT-001

完整包 SHALL 保留 service 名称、全部 retained revision/定义、desired/applied revision、enabled/required、tombstone、已绑定镜像、持久恢复预算、每个 service 的持久资源预留及当前 workspace 卷引用；导入为每个 service 分配新 ID，映射受管依赖、预留与 workspace grant。定义中的命令、args、environment、端口和固定容器路径保持原样。workspace 当前引用即使因失败的 remove 而仍属于 tombstone service，也 SHALL 映射而不隐式解除；但引用不授权 tombstone service 启动。源 observedState/error 和旧 Operation 可保留为 provenance，但不能作为新容器 ready 的证明。未 tombstone 服务在导入 stopped Work 中 SHALL 报告 stopped 或 disabled；tombstone 仍不可列为可恢复服务且名称保留，budget exhaustion 仍阻止自动恢复，显式 retry 沿用既有语义。

service 的持久 desired CPU/内存与 slots SHALL 使用包内预留值，不从 enabled、最新 definition 或源 observedState 重算；disabled 或 tombstone 不意味着其持久预算必为零。导入后的实际运行占用 SHALL 从零开始，且保留预算本身 SHALL NOT 触发服务启动。

后续显式 Work start SHALL 按 enabled、required、固定镜像与恢复策略重建，不需要 agent 重新 create。历史 appliedRevision 不变，实际就绪重新检查；不发布 host port、不添加新挂载形式、不允许镜像 build/commit、不重放历史服务 mutation。服务历史控制幂等记录仅作 provenance，不能使新 owner 请求命中源 principal 的幂等 scope。

包内 active context 选择内置 `work-services` 时，导入并显式启动后 pi-agentd SHALL 经真实 MCP adapter 和目标 Core 的认证 gRPC 列出、检查、启用、禁用、重启及按现有权限创建/更新本 Work 的 service；操作对象 SHALL 是目标新 service ID，不依赖源 Core、源证书或重新部署历史服务。源 active context 未选择该 MCP 或工具策略禁止某工具时，导入 SHALL 保持该限制，不用目标默认配置补授权。

#### Scenario: Enabled and disabled services
- **WHEN** 包有 enabled web 和 disabled worker，导入后显式 start
- **THEN** 只启动 web，使用原镜像/文件/端口，worker 保持 disabled

#### Scenario: Shared storage survives import
- **WHEN** 两个服务共享 workspace，且一个曾被删除
- **THEN** 新服务引用新 Work 的同一个 workspace，已删除服务不复活，数据不被重新初始化

#### Scenario: Preserve failed retry budget
- **WHEN** 一个服务自动恢复预算已耗尽后导出导入
- **THEN** 不因导入而清零预算或自动重试，用户仍可显式 retry

#### Scenario: Disabled service retains its reservation
- **WHEN** 一个已停止 Work 中，disabled worker 的持久 desired CPU/内存预留因失败的 disable 操作仍非零
- **THEN** 导入后的 worker 仍为 disabled 且不启动；目标 Work 记录相同的持久 desired 预留，实际运行占用为零，再次导出仍能读到该预留

#### Scenario: Manage restored services through target Core MCP
- **WHEN** 含内置 `work-services` 的 Work 从安装 A 导出、只凭包导入安装 B 并显式启动，安装 A 不再可达
- **THEN** 安装 B 的 pi-agentd 通过真实 MCP 及目标 Core gRPC 列出恢复后的 service，并以目标 service ID 完成 stop/start 与 Operation 查询；服务定义和 workspace 数据保持原样

#### Scenario: Preserve imported tool policy
- **WHEN** 源 active context 禁止 `work-services.service_stop` 或已移除内置 MCP
- **THEN** 导入后的 pi-agentd 不得到该工具，目标默认配置不能替它重新授权
