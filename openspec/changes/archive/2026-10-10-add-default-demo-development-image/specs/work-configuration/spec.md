# Spec Delta

## MODIFIED Requirements

### Requirement: Reserve deployment capacity separately from agent resources

**Identifier:** WCFG-SERVICE-001

Work 资源政策 SHALL 区分总 CPU/非 Service 内存预算与 Agent CPU/内存分配。全新默认值保留总 2000 CPU milliseconds、1536 MiB 非 Service 内存预算、Agent 1000 CPU milliseconds/768 MiB、maxServices=4、maxRetainedVolumes=2。原 Work memoryBytes 数值不代表该 Work 全部应用可用内存或 Service 硬限制。

Service 默认 SHALL 请求 250 CPU milliseconds、enabled=true、required=false、restartPolicy=bounded，内存无限制。Service 的创建、更新、恢复及导入 SHALL 不预留或核对 Service 内存；历史 Service 内存数值 SHALL 不降低有效剩余预算。Agent 分配不能超过其 Work 管理预算，Service CPU 仍须与 Agent CPU 合计检查。

Work 创建 SHALL 保留 Agent 资源预留，stopped Work 保留 desired CPU 及仍受管对象的内存预留。资源改变的 Apply SHALL 在替换前预留增加量，实际释放后才释放减少量，失败保留/恢复原分配。管理员的自定义 CPU、Agent 内存、服务数及卷数选择 SHALL 保留，不因新的基础镜像被覆盖。

#### Scenario: Deploy from a fresh default Work
- **WHEN** 新安装创建未覆盖资源的 Work，Agent 部署示例 Service
- **THEN** Agent 与至少一个 Service 的 CPU/数量满足默认政策，Service 无内存上限，不需要管理员为前端构建增加 Service 内存额度

#### Scenario: Reject insufficient budget
- **WHEN** Work CPU 低于 Agent 与保留 Service CPU 合计，或非 Service 内存预算低于 Agent 有效预留
- **THEN** create/set/apply 拒绝不兼容预算，不扰动当前容器

#### Scenario: Preserve customized defaults
- **WHEN** 管理员修改默认资源或显式将 maxServices 设置为零后重启 Core
- **THEN** Core 保留选择，不静默恢复全新默认值

#### Scenario: 只降低历史 Service 内存总数
- **WHEN** Work 的非 Service 内存预算满足 Agent，但低于旧 Agent 加 Service 内存数值之和
- **THEN** 不因历史 Service 内存数值拒绝配置，Agent 自身分配不足与 CPU 不足仍明确拒绝
